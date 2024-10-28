import WebSocket, {WebSocketServer} from 'ws';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import url from 'url';
import createTables from './db/createtables';
import syncUsers from './db/syncusers';

class FictionChat {
    constructor(config) {
        console.log(config);
        
        this.pool = new pg.Pool({
            connectionString: config.dbUrl,
        });

        this.wss = new WebSocketServer({ port: config.websocketPort });
        this.userTableConfig = config.userTableConfig;
        this.jwtSecret = config.jwtSecret;
        this.setupWebSocket();
        this.init();
    }

    async init() {
        await createTables(this.pool);
        await syncUsers(this.pool, this.userTableConfig);
    }

    setupWebSocket() {
        this.wss.on('connection', (ws, request) => {
            const token = url.parse(request.url, true).query.token;
            console.log("Trying to connect");
            console.log(token);
            if (!token) {
                ws.close(1008, 'Token not provided');
                return;
            }

            try {
                const decodedToken = jwt.verify(token, this.jwtSecret);
                const userId = decodedToken[this.userTableConfig.idColumn];
                ws.userId = userId;

                ws.on('message', async (message) => {
                    const data = JSON.parse(message);
                    switch (data.type) {
                        case 'SEND_MESSAGE':
                            const sentMessage = await this.sendMessage({...data.payload, senderId: userId});
                            this.broadcastMessage(sentMessage);
                            break;
                        case 'MARK_AS_READ':
                            await this.markAsRead({...data.payload, userId});
                            break;
                        // Add more cases as needed
                    }
                });

                ws.send(JSON.stringify({type: 'CONNECTION_SUCCESS', userId}));
            } catch (error) {
                ws.close(1008, 'Invalid token');
            }
        });
    }

    /**
     * Handles incoming HTTP requests and routes them to appropriate handler methods
     * @param {Object} req - Express request object
     * @param {Object} req.query - Query parameters
     * @param {string} req.query.method - The method to execute (e.g. 'send-message', 'get-conversations', 'get-messages')
     * @param {Object} res - Express response object
     * @returns {Promise<void>} Promise that resolves when the request is handled
     * @throws {Error} If the method is invalid or authentication fails
     */
    async handleRequest(req, res) {
        // Available methods:
        // - send-message: Send a new message in a conversation
        // - get-conversations: Get all conversations for authenticated user
        // - get-messages: Get messages for a specific conversation
        const methodName = req.query.method.replace(/-([a-z])/g, g => g[1].toUpperCase());
        if (typeof this[methodName] === 'function') {
            return this[`handle${methodName.charAt(0).toUpperCase() + methodName.slice(1)}`](req, res);
        } else {
            return res.status(400).json({ 
                error: "Invalid method",
                availableMethods: [
                    'send-message',
                    'get-conversations', 
                    'get-messages'
                ]
            });
        }
    }

    handleSendMessage = async (req, res) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).json({ error: "No auth token provided" });
            }
            const token = authHeader.split(' ')[1];
            const decodedToken = jwt.verify(token, this.jwtSecret);
            const senderId = decodedToken[this.userTableConfig.idColumn];
            const message = await this.sendMessage({ ...req.body, senderId });
            this.broadcastMessage({...message, toId: req.body.toId});
            res.status(201).json(message);
        } catch (error) {
            res.status(401).json({ error: "Invalid auth token" });
        }
    }

    handleGetConversations = async (req, res) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).json({ error: "No auth token provided" });
            }
            const token = authHeader.split(' ')[1];
            const decodedToken = jwt.verify(token, this.jwtSecret);
            const userId = decodedToken[this.userTableConfig.idColumn];
            const conversations = await this.getConversations(userId);
            res.status(200).json(conversations);
        } catch (error) {
            res.status(401).json({ error: "Invalid auth token" });
        }
    }

    handleGetMessages = async (req, res) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).json({ error: "No auth token provided" });
            }
            const token = authHeader.split(' ')[1];
            jwt.verify(token, this.jwtSecret);
            const messages = await this.getMessages(req.query.conversationId);
            res.status(200).json(messages);
        } catch (error) {
            res.status(401).json({ error: "Invalid auth token" });
        }
    }


    broadcastMessage(message) {
        this.wss.clients.forEach((client) => {

            if (client.readyState === WebSocket.OPEN && client.userId === message.toId) {
                client.send(JSON.stringify(message));
            }else{
                console.log(message)
                console.log("Not sending message to user", message.toId);
                console.log("Client state", client.readyState);
                console.log("Client user id", client.userId);
            }
        });
    }

    async sendMessage(payload) {
        console.log(payload);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            let conversationId;
            const existingConversationQuery = `
                SELECT conversation_id 
                FROM fictionchat_ConversationParticipant 
                WHERE user_id IN ($1, $2) 
                GROUP BY conversation_id 
                HAVING COUNT(DISTINCT user_id) = 2`;
            const existingConversationResult = await client.query(existingConversationQuery, [payload.senderId, payload.toId]);

            if (existingConversationResult.rows.length > 0) {
                conversationId = existingConversationResult.rows[0].conversation_id;
            } else {
                const newConversationQuery = 'INSERT INTO fictionchat_Conversation DEFAULT VALUES RETURNING id';
                const newConversationResult = await client.query(newConversationQuery);
                conversationId = newConversationResult.rows[0].id;

                const participantQuery = 'INSERT INTO fictionchat_ConversationParticipant (conversation_id, user_id) VALUES ($1, $2)';
                await client.query(participantQuery, [conversationId, payload.senderId]);
                await client.query(participantQuery, [conversationId, payload.toId]);
            }

            const messageQuery = 'INSERT INTO fictionchat_Message (sender_id, conversation_id, content) VALUES ($1, $2, $3) RETURNING *';
            const messageResult = await client.query(messageQuery, [payload.senderId, conversationId, payload.content]);

            await client.query('COMMIT');
            return messageResult.rows[0];
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async markAsRead(payload) {
        const query = 'INSERT INTO fictionchat_ChatActivity (user_id, conversation_id, last_read) VALUES ($1, $2, $3) RETURNING *';
        const values = [payload.userId, payload.conversationId, new Date()];
        const result = await this.pool.query(query, values);
        return result.rows[0];
    }

    async createUser(userData) {
        const query = 'INSERT INTO fictionchat_User (id, real_user_id, fullname, profile_picture) VALUES ($1, $2, $3, $4) RETURNING *';
        const values = [userData.realUserId, userData.realUserId, userData.fullname, userData.profilePicture];
        const result = await this.pool.query(query, values);
        return result.rows[0];
    }

    async createConversation(data) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const conversationQuery = 'INSERT INTO fictionchat_Conversation DEFAULT VALUES RETURNING id';
            const conversationResult = await client.query(conversationQuery);
            const conversationId = conversationResult.rows[0].id;

            const participantQuery = 'INSERT INTO fictionchat_ConversationParticipant (conversation_id, user_id) VALUES ($1, $2)';
            for (const participantId of data.participantIds) {
                await client.query(participantQuery, [conversationId, participantId]);
            }

            await client.query('COMMIT');
            return { id: conversationId };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async getConversations(userId) {
        const query = `
            SELECT c.id, c.created_at, 
                   json_agg(json_build_object('id', u.id, 'fullname', u.fullname, 'profilePicture', u.profile_picture)) as participants,
                   (SELECT json_build_object('id', m.id, 'content', m.content, 'createdAt', m.created_at, 'senderId', m.sender_id)
                    FROM fictionchat_Message m
                    WHERE m.conversation_id = c.id
                    ORDER BY m.created_at DESC
                    LIMIT 1) as last_message,
                   (SELECT json_build_object('id', u2.id, 'fullname', u2.fullname, 'profilePicture', u2.profile_picture)
                    FROM fictionchat_ConversationParticipant cp2
                    JOIN fictionchat_User u2 ON cp2.user_id = u2.id
                    WHERE cp2.conversation_id = c.id AND cp2.user_id != $1
                    LIMIT 1) as other_user
            FROM fictionchat_Conversation c
            JOIN fictionchat_ConversationParticipant cp ON c.id = cp.conversation_id
            JOIN fictionchat_User u ON cp.user_id = u.id
            WHERE c.id IN (SELECT conversation_id FROM fictionchat_ConversationParticipant WHERE user_id = $1)
            GROUP BY c.id
            ORDER BY c.created_at DESC
        `;
        const result = await this.pool.query(query, [userId]);
        return result.rows;
    }

    async getMessages(conversationId) {
        const query = `
            SELECT m.id, m.content, m.created_at as "createdAt", 
                   json_build_object('id', u.id, 'fullname', u.fullname, 'profilePicture', u.profile_picture) as sender
            FROM fictionchat_Message m
            JOIN fictionchat_User u ON m.sender_id = u.id
            WHERE m.conversation_id = $1
            ORDER BY m.created_at ASC
        `;
        const result = await this.pool.query(query, [conversationId]);
        return result.rows;
    }

    

    async resetChat() {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // Delete all data from fictionchat tables
            await client.query('DELETE FROM fictionchat_ChatActivity');
            await client.query('DELETE FROM fictionchat_Message');
            await client.query('DELETE FROM fictionchat_ConversationParticipant');
            await client.query('DELETE FROM fictionchat_Conversation');
            await client.query('DELETE FROM fictionchat_User');

            // Reset sequences
            await client.query('ALTER SEQUENCE fictionchat_chatactivity_id_seq RESTART WITH 1');
            await client.query('ALTER SEQUENCE fictionchat_message_id_seq RESTART WITH 1');
            await client.query('ALTER SEQUENCE fictionchat_conversationparticipant_id_seq RESTART WITH 1');
            await client.query('ALTER SEQUENCE fictionchat_conversation_id_seq RESTART WITH 1');
            await client.query('ALTER SEQUENCE fictionchat_user_id_seq RESTART WITH 1');

            await client.query('COMMIT');

            // Re-sync users
            await this.syncUsers();

            console.log("Chat reset successfully");
        } catch (e) {
            await client.query('ROLLBACK');
            console.error("Failed to reset chat:", e);
            throw e;
        } finally {
            client.release();
        }
    }

    // Add more methods for CRUD operations and other functionalities
}

export function initFictionChat(config) {
    return new FictionChat(config);
}
