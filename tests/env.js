process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-must-be-32-chars-min';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/askpdf-test';
process.env.REDIS_URL = 'memory';
process.env.GEMINI_API_KEY = 'test';
process.env.VECTOR_SEARCH = 'memory';
process.env.UPLOAD_DIR = require('path').join(__dirname, '..', 'uploads-test');
process.env.PORT = '0';
