module.exports = {
    apps: [
        {
            name: "flagia-frontend",
            script: "serve",
            env: {
                PM2_SERVE_PATH: "/Users/jkmanye/Desktop/server/Flagia/flagia-frontend/dist",
                PM2_SERVE_PORT: 3501,
                PM2_SERVE_SPA: "true",
                NODE_ENV: "production",
            },
        },
        {
            name: "flagia-backend",
            script: "dist/index.js",
            cwd: "/Users/jkmanye/Desktop/server/Flagia/flagia-backend",
            env: {
                NODE_ENV: "production",
                PORT: 3502,
                SQL_USER: "devmeko",
                SQL_PW: "Qqqq1111!",
            },
        },
    ],
};
