module.exports = {
    apps: [
        {
            name: "flagia-frontend",
            script: "serve",
            env: {
                PM2_SERVE_PATH: "~/server/Flagia/flagia-frontend/dist",
                PM2_SERVE_PORT: 5173,
                PM2_SERVE_SPA: "true",
                NODE_ENV: "production",
            },
        },
        {
            name: "flagia-backend",
            script: "dist/index.js",
            cwd: "~/server/Flagia/flagia-backend",
            env: {
                NODE_ENV: "production",
                PORT: 3000,
                SQL_USER: "flagia",
                SQL_PW: "flagia_rism",
            },
        },
    ],
};
