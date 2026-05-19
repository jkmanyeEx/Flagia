"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.initializeDatabase = initializeDatabase;
const promise_1 = __importDefault(require("mysql2/promise"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config = {
    host: process.env.SQL_HOST || 'localhost',
    user: process.env.SQL_USER || 'devmeko',
    password: process.env.SQL_PASSWORD || process.env.SQL_PW || 'Qqqq1111!',
    database: process.env.SQL_DATABASE || 'flagia',
    multipleStatements: true
};
async function initializeDatabase() {
    try {
        // Connect without database to ensure it exists
        const connection = await promise_1.default.createConnection({
            host: config.host,
            user: config.user,
            password: config.password
        });
        console.log('Verifying flagia database existence...');
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
        await connection.end();
        // Create the pool
        exports.pool = promise_1.default.createPool(config);
        // Apply the schema
        const schemaPath = path_1.default.join(__dirname, '../mysql_dump.sql');
        if (fs_1.default.existsSync(schemaPath)) {
            console.log('Executing mysql_dump.sql schema migrations...');
            const schemaSql = fs_1.default.readFileSync(schemaPath, 'utf8');
            await exports.pool.query(schemaSql);
            console.log('Database and tables initialized successfully.');
        }
        else {
            console.warn('mysql_dump.sql not found at', schemaPath);
        }
    }
    catch (error) {
        console.error('Database initialization failed:', error);
        throw error;
    }
}
