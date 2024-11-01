import WebSocket, { WebSocketServer } from 'ws';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import url from 'url';

export class FictionChat {
    constructor(config) {
        console.log("Entire config")
        console.log(config);

        this.pool = new pg.Pool({
            connectionString: config.dbUrl,
        });

        this.activeConnections = new Map();

        this.wss = new WebSocketServer({ port: config.websocketPort });
        this.userTableConfig = config.userTableConfig;
        this.jwtSecret = config.jwtSecret;
        this.jwtUserIdColumn = config.jwtUserIdColumn;
        this.setupWebSocket();
        this.initialized = false;
        this.init().then(() => {
            this.initialized = true;
            console.log("FictionChat initialized");
        }).catch(err => {
            console.error('Failed to initialize FictionChat:', err);
            throw err;
        });
    }

    async init() {
        await this.createTables(this.pool);
        await this.syncUsers(this.pool, this.userTableConfig);
    }

    async syncUsers(pool, userTableConfig) {
        console.log("Syncing users");
        const { tableName, idColumn, fullNameColumn, profilePictureColumn } = userTableConfig;
        const query = `
            SELECT ${idColumn} as id, ${fullNameColumn} as fullname, ${profilePictureColumn} as "profilePicture"
            FROM "${tableName}"
        `;
        console.log("Querying users");
        const externalUsers = await pool.query(query);
        console.log("Users queried");
        for (const user of externalUsers.rows) {
            const upsertQuery = `
                INSERT INTO fictionchat_User (id, real_user_id, fullname, profile_picture)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (real_user_id) 
                    DO UPDATE SET fullname = $3, profile_picture = $4
                    RETURNING *
                `;
            await pool.query(upsertQuery, [user.id, user.id, user.fullname, user.profilePicture]);
        }
        console.log("Users upserted");
        console.log("Users synced successfully");
    }

    async createTables(pool) {
        const queries = [
            `CREATE TABLE IF NOT EXISTS fictionchat_User (
                id VARCHAR(255) PRIMARY KEY,
                real_user_id VARCHAR(255) UNIQUE NOT NULL,
                fullname VARCHAR(255) NOT NULL,
                profile_picture TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS fictionchat_Conversation (
                id SERIAL PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS fictionchat_ConversationParticipant (
                id SERIAL PRIMARY KEY,
                conversation_id INTEGER REFERENCES fictionchat_Conversation(id),
                user_id VARCHAR(255) REFERENCES fictionchat_User(id)
            )`,
            `CREATE TABLE IF NOT EXISTS fictionchat_Message (
                id SERIAL PRIMARY KEY,
                sender_id VARCHAR(255) REFERENCES fictionchat_User(id),
                conversation_id INTEGER REFERENCES fictionchat_Conversation(id),
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS fictionchat_ChatActivity (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255) REFERENCES fictionchat_User(id),
                conversation_id INTEGER REFERENCES fictionchat_Conversation(id),
                last_read TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        for (const query of queries) {
            await pool.query(query);
        }
        console.log("Tables created successfully");
    }

    setupWebSocket() {
        this.activeConnections = new Map();

        this.wss.on('connection', (ws, request) => {
            const token = url.parse(request.url, true).query.token;

            if (!token) {
                ws.close(1008, 'Token not provided');
                return;
            }

            try {
                const decodedToken = jwt.verify(token, this.jwtSecret);
                const userId = decodedToken[this.jwtUserIdColumn];

                // Remove the previous connection for this user if it exists
                if (this.activeConnections.has(userId)) {
                    this.activeConnections.get(userId).close();
                }

                ws.userId = userId;
                this.activeConnections.set(userId, ws);

                ws.on('message', async (message) => {
                    const data = JSON.parse(message);
                    switch (data.type) {
                        case 'MARK_AS_READ':
                            await this.markAsRead({ ...data.payload, userId });
                            break;
                        // Add more cases as needed
                    }
                });

                ws.send(JSON.stringify({ type: 'CONNECTION_SUCCESS', userId }));
                console.log("Client added", ws.userId);
                console.log("Total active clients", this.activeConnections.size);

                ws.on('close', () => {
                    this.activeConnections.delete(userId);
                    console.log("Client disconnected", ws.userId);
                });

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
        console.log("Handling request")
        // Available methods:
        // - send-message: Send a new message in a conversation
        // - get-conversations: Get all conversations for authenticated user
        // - get-messages: Get messages for a specific conversation
        // - get-available-users-to-chat: Get all users except the authenticated user
        // - create-convo: Create a new conversation with another user
        if (!req.query.method) {
            return res.status(200).json({ error: "chat should working fine" });
        }
        const methodName = req.query.method.replace(/-([a-z])/g, g => g[1].toUpperCase());
        console.log("Method name", methodName)
        if (typeof this[methodName] === 'function') {
            return this[`handle${methodName.charAt(0).toUpperCase() + methodName.slice(1)}`](req, res);
        } else {
            return res.status(400).json({
                error: "Invalid method",
                availableMethods: [
                    'send-message',
                    'get-conversations',
                    'get-messages',
                    'get-available-users-to-chat',
                    'create-convo'
                ]
            });
        }
    }

    handleCreateConvo = async (req, res) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).json({ error: "No auth token provided" });
            }
            const token = authHeader.split(' ')[1];
            const decodedToken = jwt.verify(token, this.jwtSecret);
            const fromId = decodedToken[this.jwtUserIdColumn];
            const { toId } = req.body.params;

            // Check if conversation already exists between these users
            const existingConvoQuery = `
                SELECT DISTINCT c.id 
                FROM fictionchat_Conversation c
                JOIN fictionchat_ConversationParticipant p1 ON c.id = p1.conversation_id
                JOIN fictionchat_ConversationParticipant p2 ON c.id = p2.conversation_id
                WHERE p1.user_id = $1 AND p2.user_id = $2
            `;
            const existingConvo = await this.pool.query(existingConvoQuery, [fromId, toId]);
            
            if (existingConvo.rows.length > 0) {
                return res.status(200).json({ conversationId: existingConvo.rows[0].id });
            }

            // If no existing conversation, create a new one
            const client = await this.pool.connect();
            try {
                await client.query('BEGIN');

                // Create conversation
                const conversationResult = await client.query(
                    'INSERT INTO fictionchat_Conversation DEFAULT VALUES RETURNING id'
                );
                const conversationId = conversationResult.rows[0].id;

                // Add participants
                await client.query(
                    'INSERT INTO fictionchat_ConversationParticipant (conversation_id, user_id) VALUES ($1, $2), ($1, $3)',
                    [conversationId, fromId, toId]
                );

                await client.query('COMMIT');
                res.status(201).json({ conversationId });
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error("Error creating conversation:", error);
            res.status(401).json({ error: "Failed to create conversation" });
        }
    }

    handleGetAvailableUsersToChat = async (req, res) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).json({ error: "No auth token provided" });
            }
            const token = authHeader.split(' ')[1];
            const decodedToken = jwt.verify(token, this.jwtSecret);
            console.log(decodedToken)
            console.log(this.jwtUserIdColumn)

            const myId = decodedToken[this.jwtUserIdColumn];
            const users = await this.getAvailableUsersToChat(myId);
            res.status(200).json(users);
        } catch (error) {
            res.status(401).json({ error: "Invalid auth token" });
        }
    }

    async getAvailableUsersToChat(myId) {
        const query = `
            SELECT id, fullname, profile_picture FROM fictionchat_User WHERE id != $1
        `;
        console.log(query, myId)

        const result = await this.pool.query(query, [myId]);
        return result.rows;
    }

    handleSendMessage = async (req, res) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).json({ error: "No auth token provided" });
            }
            const token = authHeader.split(' ')[1];
            const decodedToken = jwt.verify(token, this.jwtSecret);
            const senderId = decodedToken[this.jwtUserIdColumn];
            const message = await this.sendMessage({ ...req.body, senderId });
            // Only broadcast here, not after sending response
            this.broadcastMessage({ ...message, toId: req.body.toId });
            res.status(201).json(message);
        } catch (error) {
            res.status(401).json({ error: "Invalid auth token" });
        }
    }

    handleGetConversations = async (req, res) => {
        try {
            console.log("Getting conversations")
            console.log(req.headers.authorization)
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).json({ error: "No auth token provided" });
            }
            const token = authHeader.split(' ')[1];
            const decodedToken = jwt.verify(token, this.jwtSecret);
            const userId = decodedToken[this.jwtUserIdColumn];
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
            const decodedToken = jwt.verify(token, this.jwtSecret);
            const userId = decodedToken[this.jwtUserIdColumn];
            const messages = await this.getMessages(req.query.conversationId, userId);
            res.status(200).json(messages);
        } catch (error) {
            res.status(401).json({ error: "Invalid auth token" });
        }
    }



    broadcastMessage(message) {
        const recipientWs = this.activeConnections.get(message.toId);
        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
            recipientWs.send(JSON.stringify(message));
            console.log("Broadcasted message to user", message.toId);
        } else {
            console.log("Not sending message; user not connected or WebSocket not open", message.toId);
        }
    }

    async sendMessage(payload) {
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

            // Fix the syntax error by separating the INSERT and SELECT into two steps
            const insertMessageQuery = `
                INSERT INTO fictionchat_Message (sender_id, conversation_id, content) 
                VALUES ($1, $2, $3) 
                RETURNING *`;
            const insertedMessage = await client.query(insertMessageQuery, [payload.senderId, conversationId, payload.content]);

            const messageQuery = `
                SELECT m.*, 
                       json_build_object('id', u.id, 'fullname', u.fullname, 'profilePicture', u.profile_picture) as sender
                FROM fictionchat_Message m
                JOIN fictionchat_User u ON m.sender_id = u.id
                WHERE m.id = $1`;

            const messageResult = await client.query(messageQuery, [insertedMessage.rows[0].id]);

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
                    LIMIT 1) as other_user,
                   (SELECT u2.id
                    FROM fictionchat_ConversationParticipant cp2
                    JOIN fictionchat_User u2 ON cp2.user_id = u2.id
                    WHERE cp2.conversation_id = c.id AND cp2.user_id != $1
                    LIMIT 1) as other_user_id
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

    async getMessages(conversationId, userId) {
        const query = `
            SELECT m.id, m.content, m.created_at as "createdAt",
                   json_build_object('id', u.id, 'fullname', u.fullname, 'profilePicture', u.profile_picture) as sender,
                   CASE WHEN m.sender_id = $2 THEN true ELSE false END as "isFromMe"
            FROM fictionchat_Message m
            JOIN fictionchat_User u ON m.sender_id = u.id
            WHERE m.conversation_id = $1
            ORDER BY m.created_at ASC
        `;
        const result = await this.pool.query(query, [conversationId, userId]);
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
