export class AppError extends Error {
    constructor(message, statusCode = 500, details = null) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.details = details;
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

export const errorHandler = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    // Log error
    console.error('Error:', {
        name: err.name,
        message: err.message,
        statusCode: err.statusCode,
        stack: err.stack,
        details: err.details
    });

    res.status(err.statusCode).json({
        status: err.status,
        error: {
            message: err.message,
            code: err.code || 'INTERNAL_ERROR',
            details: err.details || null
        }
    });
};
