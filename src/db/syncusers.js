export default async function syncUsers(pool, userTableConfig) {
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