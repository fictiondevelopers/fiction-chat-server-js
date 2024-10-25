import jwt from 'jsonwebtoken';

const secretKey = 'your-secret-key'; // Replace with a secure secret key
const payload = { id: 2 };

function signToken() {
    return jwt.sign(payload, secretKey, { expiresIn: '1h' });
}

const token = signToken();
console.log('Signed JWT token:', token);

export default signToken;
