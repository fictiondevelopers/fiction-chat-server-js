import express from 'express';
import http from 'http';
import { initFictionChat } from './src/FictionChat.js';

const app = express();
const server = http.createServer(app);

const fictionChatConfig = {
    dbUrl: 'postgresql://postgres:postgres@localhost:5432/fictionchatserverplugin',
    websocketPort: 8080,
    userTableConfig: {
        tableName: 'users',
        idColumn: 'id',
        fullNameColumn: 'fullname',
        profilePictureColumn: 'profile_picture_url'
    },
    jwtSecret: 'your-secret-key'
};

const fictionChat = initFictionChat(fictionChatConfig);

app.use(express.json());

app.use('/fictionchat', fictionChat.expressRouter);

// Add your routes here

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});


// Cleanup on server shutdown
process.on('SIGINT', async () => {
    process.exit();
});
