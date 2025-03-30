// server.js

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { JobManager } from './src/services/JobManager.js';
import { config } from './src/config/default.js';
import router from './src/routes/index.js';  // Updated path
import proxyRoutes from './src/routes/proxyRoutes.js';  // Updated path
import { errorHandler, AppError } from './src/utils/errorHandler.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get directory name in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

class Server {
    constructor() {
        this.app = express();
        this.server = null;
        this.io = null;
        this.jobManager = null;
        // Let Railway control the port
        this.port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
        this.env = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || 'development';
        
        // Updated CORS configuration using config
        this.corsOptions = {
            origin: (origin, callback) => {
                if (!origin || config.CORS.ORIGIN.includes(origin)) {
                    callback(null, true);
                } else {
                    console.warn('Rejected Origin:', origin);
                    callback(new Error('Not allowed by CORS'));
                }
            },
            methods: config.CORS.METHODS,
            allowedHeaders: config.CORS.ALLOWED_HEADERS,
            exposedHeaders: config.CORS.EXPOSED_HEADERS,
            credentials: true,
            preflightContinue: false,
            optionsSuccessStatus: 204
        };

        // Initialize server
        this.initializeMiddleware();
        this.initializeRoutes();
        this.initializeErrorHandling();
    }

    /**
     * Initialize all middleware
     */
    initializeMiddleware() {
        // Apply CORS with proper preflight handling
        this.app.use(cors({
            ...this.corsOptions,
            maxAge: 86400, // 24 hours
            credentials: true,
            exposedHeaders: ['Content-Disposition', 'Content-Length']
        }));
        
        // Handle OPTIONS preflight requests
        this.app.options('*', cors(this.corsOptions));

        // Update security headers
        this.app.use(helmet({
            crossOriginResourcePolicy: { policy: "cross-origin" },
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    connectSrc: ["'self'", ...config.CORS.ORIGIN],
                    imgSrc: ["'self'", "data:", "blob:"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'"],
                    formAction: ["'self'"]
                }
            }
        }));

        // Simple body parsing strategy
        this.app.use((req, res, next) => {
            if (!req.headers['content-type']?.includes('multipart/form-data')) {
                express.json({
                    limit: config.conversion.maxFileSize || '50mb'
                })(req, res, next);
            } else {
                // Let multer handle multipart
                next();
            }
        });

        // Request timestamp and logging
        this.app.use((req, res, next) => {
            req.requestTime = new Date().toISOString();
            console.log(`${req.method} ${req.path}`, {
                contentType: req.headers['content-type'],
                timestamp: req.requestTime
            });
            next();
        });
    }

    /**
     * Initialize API routes
     */
    initializeRoutes() {
        // API Routes
        this.app.use('/api/v1', router);  // Mount routes directly under /api/v1
        this.app.use('/api/v1/proxy', proxyRoutes);

        // Root route
        this.app.get('/', (req, res) => {
            res.status(200).json({
                status: 'success',
                message: 'Welcome to the Conversion API',
                documentation: '/api/v1/docs'
            });
        });

        // Handle undefined routes
        this.app.all('*', (req, res, next) => {
            next(new AppError(`Cannot find ${req.originalUrl} on this server!`, 404));
        });
    }

    /**
     * Initialize error handlers
     */
    initializeErrorHandling() {
        this.app.use(errorHandler);
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
            console.error(error.name, error.message);
            process.exit(1);
        });

        // Handle unhandled rejections
        process.on('unhandledRejection', (error) => {
            console.error('UNHANDLED REJECTION! 💥 Shutting down...');
            console.error(error.name, error.message);
            this.server.close(() => {
                process.exit(1);
            });
        });

        // Handle SIGTERM
        process.on('SIGTERM', () => {
            console.log('👋 SIGTERM RECEIVED. Shutting down gracefully');
            this.server.close(() => {
                console.log('💥 Process terminated!');
            });
        });
    }

    /**
     * Start the server
     */
    async start() {
        try {
            return new Promise((resolve, reject) => {
                // Create HTTP server
                this.server = this.app.listen(this.port, () => {
                    // Initialize Socket.IO
                    this.io = new SocketServer(this.server, {
                        cors: {
                            origin: "*",
                            methods: ["GET", "POST"]
                        }
                    });

                    // Initialize JobManager
                    this.jobManager = new JobManager(this.io);

                    // Setup Socket.IO event handlers
                    this.io.on('connection', (socket) => {
                        console.log('🔌 Client connected:', socket.id);

                        // Handle job subscriptions
                        socket.on('subscribe:job', ({ jobId }) => {
                            socket.join(`job:${jobId}`);
                            console.log('👥 Client subscribed to job:', {
                                socketId: socket.id,
                                jobId
                            });
                        });

                        socket.on('unsubscribe:job', ({ jobId }) => {
                            socket.leave(`job:${jobId}`);
                            console.log('👋 Client unsubscribed from job:', {
                                socketId: socket.id,
                                jobId
                            });
                        });

                        socket.on('disconnect', () => {
                            console.log('🔌 Client disconnected:', socket.id);
                        });
                    });

                    console.log(`🚀 Server is running on http://localhost:${this.port}`);
                    console.log('🚀 Server Details:');
                    console.log(`   Environment: ${this.env}`);
                    console.log(`   Port: ${this.port}`);
                    console.log(`   API Base Path: /api/v1`);
                    console.log('   CORS enabled for:', this.corsOptions.origin);
                    resolve(this.server);
                });

                this.server.on('error', (error) => {
                    if (error.code === 'EADDRINUSE') {
                        console.error(`❌ Port ${this.port} is already in use`);
                    } else {
                        console.error('❌ Server error:', error);
                    }
                    reject(error);
                });
            });
        } catch (error) {
            console.error('❌ Failed to start server:', error);
            throw error;
        }
    }

    /**
     * Get Express app instance
     */
    getApp() {
        return this.app;
    }

    /**
     * Get JobManager instance
     */
    getJobManager() {
        return this.jobManager;
    }
}

// Initialize and start server
let serverInstance = null;

async function startServer() {
    try {
        const server = new Server();
        serverInstance = await server.start();
        
        // Store server instance globally for access to JobManager
        global.server = server;
        
        return serverInstance;
    } catch (error) {
        console.error('❌ Server initialization failed:', error);
        process.exit(1);
    }
}

// Start the server if not in test environment
if (process.env.NODE_ENV !== 'test') {
    startServer().then(() => {
        console.log('🔧 Server utilities:', {
            jobManager: global.server?.jobManager ? 'initialized' : 'not initialized',
            socketIO: global.server?.io ? 'connected' : 'not connected'
        });
    });
}

// Cleanup on exit
process.on('exit', () => {
    if (global.server?.jobManager) {
        global.server.jobManager.cleanup();
    }
});

export default startServer;
