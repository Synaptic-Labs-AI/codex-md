/**
 * ServiceRegistry.js
 * 
 * Manages application services, providing centralized 
 * initialization, dependency injection, and lifecycle management.
 * 
 * This module helps in organizing services and ensuring
 * proper initialization and cleanup.
 */

const path = require('path');
const fs = require('fs-extra');
const logger = require('../utils/logger');

class ServiceRegistry {
    constructor() {
        this.services = new Map();
        this.initialized = false;
    }
    
    /**
     * Register a service with the registry
     * @param {string} name - Service name
     * @param {Object} service - Service instance
     * @param {Object} options - Registration options
     * @param {string[]} options.dependencies - Names of services this service depends on
     * @param {Function} options.initialize - Optional async initialization function
     * @param {Function} options.cleanup - Optional async cleanup function
     */
    register(name, service, options = {}) {
        if (this.services.has(name)) {
            console.warn(`Service "${name}" is already registered. Skipping.`);
            return;
        }
        
        this.services.set(name, {
            instance: service,
            initialized: false,
            dependencies: options.dependencies || [],
            initialize: options.initialize || (async () => true),
            cleanup: options.cleanup || (async () => true)
        });
        
        console.log(`Registered service: ${name}`);
    }
    
    /**
     * Get a service instance by name
     * @param {string} name - Service name
     * @returns {Object|null} Service instance or null if not found
     */
    getService(name) {
        const service = this.services.get(name);
        return service ? service.instance : null;
    }
    
    /**
     * Initialize all registered services in dependency order
     * @returns {Promise<boolean>} Whether initialization was successful
     */
    async initialize() {
        try {
            if (this.initialized) {
                console.log('Service registry already initialized');
                return true;
            }
            
            console.log('Initializing service registry...');
            
            // Build dependency graph and check for circular dependencies
            const dependencyOrder = this._resolveInitializationOrder();
            
            // Initialize services in dependency order
            for (const serviceName of dependencyOrder) {
                const service = this.services.get(serviceName);
                
                try {
                    console.log(`Initializing service: ${serviceName}`);
                    
                    // Initialize the service
                    await service.initialize.call(service.instance);
                    
                    // Mark as initialized
                    service.initialized = true;
                    console.log(`✅ Service initialized: ${serviceName}`);
                } catch (error) {
                    console.error(`❌ Failed to initialize service ${serviceName}:`, error);
                    if (logger.isInitialized) {
                        await logger.error(`Service initialization error: ${serviceName}`, error);
                    }
                    // Continue with other services but return false at the end
                    this.initialized = false;
                }
            }
            
            this.initialized = true;
            console.log('✅ Service registry initialized successfully');
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize service registry:', error);
            return false;
        }
    }
    
    /**
     * Clean up all registered services in reverse dependency order
     */
    async cleanup() {
        try {
            if (!this.initialized) {
                console.log('Service registry not initialized, nothing to clean up');
                return;
            }
            
            console.log('Cleaning up service registry...');
            
            // Get services in reverse dependency order
            const dependencyOrder = this._resolveInitializationOrder().reverse();
            
            // Clean up services
            for (const serviceName of dependencyOrder) {
                const service = this.services.get(serviceName);
                
                if (service.initialized) {
                    try {
                        console.log(`Cleaning up service: ${serviceName}`);
                        await service.cleanup.call(service.instance);
                        service.initialized = false;
                        console.log(`✅ Service cleaned up: ${serviceName}`);
                    } catch (error) {
                        console.error(`❌ Error cleaning up service ${serviceName}:`, error);
                        if (logger.isInitialized) {
                            await logger.error(`Service cleanup error: ${serviceName}`, error);
                        }
                    }
                }
            }
            
            this.initialized = false;
            console.log('✅ Service registry cleaned up successfully');
        } catch (error) {
            console.error('❌ Failed to clean up service registry:', error);
        }
    }
    
    /**
     * Register standard application services
     */
    registerStandardServices() {
        try {
            // Import services
            const ApiKeyService = require('../services/ApiKeyService');
            const ElectronConversionService = require('../services/ElectronConversionService');
            const FileStorageService = require('../services/storage/FileStorageService');
            const FileProcessorService = require('../services/storage/FileProcessorService');
            const DeepgramService = require('../services/ai/DeepgramService');
            
            // Register services with dependencies
            this.register('apiKey', ApiKeyService, {
                dependencies: []
            });
            
            this.register('fileStorage', FileStorageService, {
                dependencies: []
            });
            
            this.register('fileProcessor', FileProcessorService, {
                dependencies: ['fileStorage']
            });
            
            this.register('deepgram', DeepgramService, {
                dependencies: ['apiKey']
            });
            
            this.register('conversion', ElectronConversionService, {
                dependencies: ['fileStorage', 'fileProcessor'],
                initialize: async () => {
                    await ElectronConversionService.setupOutputDirectory();
                    return true;
                }
            });
            
            console.log('✅ Standard services registered');
        } catch (error) {
            console.error('❌ Failed to register standard services:', error);
        }
    }
    
    /**
     * Resolve the initialization order based on dependencies
     * @private
     * @returns {string[]} Service names in dependency order
     */
    _resolveInitializationOrder() {
        // Build dependency graph
        const graph = {};
        for (const [name, service] of this.services.entries()) {
            graph[name] = service.dependencies;
        }
        
        // Check for cycles and resolve order
        const visited = new Set();
        const temp = new Set();
        const order = [];
        
        const visit = (node) => {
            // Skip if already visited
            if (visited.has(node)) {
                return;
            }
            
            // Check for cycles
            if (temp.has(node)) {
                throw new Error(`Circular dependency detected involving service: ${node}`);
            }
            
            // Mark as temporarily visited
            temp.add(node);
            
            // Visit dependencies
            const dependencies = graph[node] || [];
            for (const dep of dependencies) {
                if (!this.services.has(dep)) {
                    console.warn(`Missing dependency: ${dep} for service ${node}`);
                    continue;
                }
                visit(dep);
            }
            
            // Mark as visited and add to order
            temp.delete(node);
            visited.add(node);
            order.push(node);
        };
        
        // Visit all nodes
        for (const name of Object.keys(graph)) {
            if (!visited.has(name)) {
                visit(name);
            }
        }
        
        return order;
    }
}

// Export a singleton instance
module.exports = new ServiceRegistry();