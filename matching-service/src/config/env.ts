export const config = {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT) || 3002,
    jwt: {
        secret: process.env.JWT_SECRET ?? 'dev-jwt-secret',
    },
    mongo: {
        uri: process.env.MONGO_URI ?? '',
        dbName: process.env.MONGO_DB_NAME ?? '',
    },
};
