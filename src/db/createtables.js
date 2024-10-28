

export default async function createTables(pool) {
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