import { MongoClient, ServerApiVersion } from 'mongodb';

let connection;

class DatabaseConfigurationError extends Error {
  name = 'DatabaseConfigurationError';
}

export async function database() {
  const uri = process.env.MONGODB_URI;
  const name = process.env.MONGODB_DB;
  if (!uri || !name) throw new DatabaseConfigurationError('MongoDB server configuration missing');
  if (!connection) {
    let client;
    try {
      client = new MongoClient(uri, {
        maxPoolSize: 8, connectTimeoutMS: 6000, serverSelectionTimeoutMS: 6000, socketTimeoutMS: 12000,
        serverApi: { version: ServerApiVersion.v1 },
      });
    } catch {
      throw new DatabaseConfigurationError('MongoDB server configuration is invalid');
    }
    connection = client.connect().catch(async error => {
      connection = undefined;
      await client.close().catch(() => {});
      throw error;
    });
  }
  return (await connection).db(name);
}
