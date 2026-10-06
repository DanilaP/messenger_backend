import { Pool, QueryResult, QueryResultRow, types } from "pg";
import dotenv from "dotenv";
dotenv.config();

// INT8 (BIGINT/BIGSERIAL, OID 20) возвращаем как number вместо string
types.setTypeParser(types.builtins.INT8, (value: string) => parseInt(value, 10));

const connectionString = process.env.DB_URL as string;

const pool = new Pool({
	connectionString,
	max: 20,
	idleTimeoutMillis: 30000,
});

export const db = {
	query: async <T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> =>
        pool.query(text, params) as Promise<QueryResult<T>>,
	getClient: () => pool.connect(),
	pool,
};

process.on("SIGINT", async () => {
	await pool.end();
	console.log("Соединение с базой данных закрыто");
	process.exit(0);
});