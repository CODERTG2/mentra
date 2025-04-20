const ort = require('onnxruntime-node');
const fs = require('fs');
const path = require('path');

let session = null;
let tokenizer = null;

async function initializeAI() {
    try {
        console.log('Initializing AI service...');
        
        const tokenizerPath = path.join(__dirname, 'tokenizer.json');
        const tokenizerData = JSON.parse(fs.readFileSync(tokenizerPath, 'utf8'));
        
        tokenizer = {
            word_index: tokenizerData.word_index,
            texts_to_sequences: function(texts) {
                return texts.map(text => {
                    const cleanedText = text.replace(/\s+/g, ' ').trim().toLowerCase();
                    const words = cleanedText.split(' ');
                    
                    return words.map(word => this.word_index[word] || 0);
                });
            }
        };
        
        const modelPath = path.join(__dirname, 'auto-eval1.onnx');
        
        session = await ort.InferenceSession.create(modelPath);
        console.log('ONNX model loaded successfully');
    } catch (error) {
        console.error('Error initializing AI service:', error);
    }
}

async function evaluateEssay(essay) {
    try {
        if (!session || !tokenizer) {
            console.error('AI service not properly initialized. session:', !!session, 'tokenizer:', !!tokenizer);
            throw new Error('AI service not initialized. Call initializeAI() first.');
        }
        
        const cleanedEssay = essay.replace(/\s+/g, ' ').trim();
        
        const sequences = tokenizer.texts_to_sequences([cleanedEssay]);
        
        let paddedSequence = null;
        if (sequences[0].length > 1000) {
            paddedSequence = sequences[0].slice(0, 1000);
        }
        else {
            paddedSequence = new Array(1000).fill(0);
            for (let i = 0; i < sequences[0].length; i++) {
                paddedSequence[i] = sequences[0][i];
            }
        }
        
        const inputName = session.inputNames[0];            
        const inputTensorFloat = new ort.Tensor('float32', Float32Array.from(paddedSequence), [1, 1000]);
        const feedsFloat = {};
        feedsFloat[inputName] = inputTensorFloat;
            
        const resultsFloat = await session.run(feedsFloat);
            
        const outputName = session.outputNames[0];            
        const outputData = resultsFloat[outputName].data;
        const rawScore = outputData[0];
        const finalScore = 5 * rawScore + 1;
        console.log(`Raw prediction: ${rawScore}, Final score: ${finalScore}`);
            
        return Math.round(finalScore);
    } catch (error) {
        console.error('Error evaluating essay:', error);
        throw error;
    }
}

module.exports = {
    initializeAI,
    evaluateEssay
};