# Fiction Chat

## Under Development

install with npm i fiction-chat-server

and then create a api route in your backend project and put the below code in it

```
import { initFictionChat } from 'fiction-chat/src/FictionChat';

const fictionChatConfig = {
    dbUrl: process.env.DATABASE_URL,
    websocketPort: parseInt(process.env.WEBSOCKET_PORT || '8080'),
    userTableConfig: {
        tableName: 'User',
        idColumn: 'id',
        fullNameColumn: 'name',
        profilePictureColumn: 'avatar'
    },
    jwtSecret: process.env.JWT_SECRET,
    jwtUserIdColumn: 'userId'
};


const fictionChat = new initFictionChat(fictionChatConfig);
// Wait for initialization before accepting requests
await new Promise((resolve, reject) => {
    const checkInit = () => {
        if (fictionChat.initialized) {
            resolve();
        } else {
            setTimeout(checkInit, 100);
        }
    };
    checkInit();
});
export default async function handler(req, res) {

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    const queryparammethod = req.query.method;
    let newReq = {
        ...req,
        url: `/${queryparammethod}`,
        method: queryparammethod,
        headers: req.headers
    }
    return fictionChat.handleRequest(newReq, res);
}

```js


you can modify the config to fit your database schema, and there is a UI also for this, you can the UI on npm, fiction-chat-client




example implementation of this can be found here: https://github.com/fictiondevelopers/fiction-chat-example

specific path for server code in your backend project's example is here: https://github.com/fictiondevelopers/fiction-chat-example/blob/main/backend/pages/api/chat/route.js