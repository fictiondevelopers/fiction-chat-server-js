# **Fiction Chat Server**

Fiction Chat Server is an npm package designed to integrate real-time chat capabilities into your backend server. It manages WebSocket connections and handles chat requests, forming the backend of the Fiction Chat system. To work correctly, this package requires the `fiction-chat-client` package for the frontend.

**Note**: This package is intended to be used with [fiction-chat-client](https://www.npmjs.com/package/fiction-chat-client), which provides the frontend chat functionality for a complete chat solution.

## **Installation**

Install the package using npm:

bash

Copy code

* `npm install fiction-chat-server`


  ## **Configuration**

To use Fiction Chat Server, create a route on your server that sets up and configures the Fiction Chat instance as shown in the example below.

### **Example Setup**

javascript

Copy code

* `import { FictionChat } from 'fiction-chat-server';`  
*   
* `const fictionChatConfig = {`  
*     `dbUrl: process.env.DATABASE_URL,`  
*     `websocketPort: parseInt(process.env.WEBSOCKET_PORT || '8080'),`  
*     `userTableConfig: {`  
*         `tableName: 'User',`  
*         `idColumn: 'id',`  
*         `fullNameColumn: 'name',`  
*         `profilePictureColumn: 'avatar'`  
*     `},`  
*     `jwtSecret: process.env.JWT_SECRET,`  
*     `jwtUserIdColumn: 'id'`  
* `};`  
*   
* `const fictionChat = new FictionChat(fictionChatConfig);`  
*   
* `// Wait for initialization before accepting requests`  
* `await new Promise((resolve) => {`  
*     `const checkInit = () => {`  
*         `if (fictionChat.initialized) {`  
*             `resolve();`  
*         `} else {`  
*             `setTimeout(checkInit, 100);`  
*         `}`  
*     `};`  
*     `checkInit();`  
* `});`  
*   
* `export default async function handler(req, res) {`  
*     `if (req.method === 'OPTIONS') {`  
*         `return res.status(200).end();`  
*     `}`  
*   
*     `const queryparammethod = req.query.method;`  
*     `const newReq = {`  
*         `...req,`  
*         ``url: `/${queryparammethod}`,``  
*         `method: queryparammethod,`  
*         `headers: req.headers`  
*     `};`  
*   
*     `if (!fictionChat.initialized) {`  
*         `return res.status(400).json({ error: 'FictionChat is not initialized' });`  
*     `}`  
*   
*     `return fictionChat.handleRequest(newReq, res);`  
* `}`


  ### **Environment Variables**

The following environment variables are required:

* **`DATABASE_URL`**: URL of your database.  
* **`WEBSOCKET_PORT`**: Port number for the WebSocket server (default is 8080).  
* **`JWT_SECRET`**: Secret key for JWT authentication.

  ### **Database Configuration**

Fiction Chat Server requires a table to store user information. In the configuration object (`userTableConfig`), specify the following fields:

* `tableName`: The name of the table in your database.  
* `idColumn`: The unique identifier column for users.  
* `fullNameColumn`: The column storing users' full names.  
* `profilePictureColumn`: The column storing users' profile pictures (optional).

  ## **Example Implementation**

For a full implementation of Fiction Chat Server and Client in a Next.js application, refer to the [fiction-chat-example](https://github.com/fictiondevelopers/fiction-chat-example) repository.

* **Backend Implementation**: Check out the `route.js` file for the backend setup of the chat server [here](https://github.com/fictiondevelopers/fiction-chat-example/blob/main/backend/pages/api/chat/route.js).

  ## **Support**

For any questions or issues, contact us:

* Phone: \+92 300 955 0284  
* Email: info@fictiondevelopers.com  
* 

