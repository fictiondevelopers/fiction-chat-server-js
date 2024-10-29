export interface FictionChatConfig {
  dbUrl: string;
  websocketPort: number;
  userTableConfig: {
    tableName: string;
    idColumn: string;
    fullNameColumn: string;
    profilePictureColumn: string;
  };
  jwtSecret: string;
  jwtUserIdColumn: string;
}

export function initFictionChat(config: FictionChatConfig): void;
