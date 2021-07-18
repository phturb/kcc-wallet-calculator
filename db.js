const redis = require('redis');
const { promisifyAll } = require('bluebird');

promisifyAll(redis);

class DB {
    static instance;

    constructor() {
        this.client = redis.createClient({
            host: '127.0.0.1',
            port: 6379
        })
        this.client.on('error', err => {
            console.log('Error ' + err);
        });
    };

    static getInstance() {
        if (!this.instance) {
            this.instance = new DB();
        }
        return this.instance;
    };

    async get(set, key) {
        const rawValue = await this.client.hmgetAsync(set, key)
        return JSON.parse(rawValue);
    }

    async getAll(set) {
        const rawValues = await this.client.hgetallAsync(set)
        const result = {};
        if (rawValues) {
            Object.keys(rawValues).forEach((key) => {
                result[key] = JSON.parse(rawValues[key]);
            })
        }
        return result;
    }

    async set(set, key, value) {
        const stringifyValue = JSON.stringify(value);
        await this.client.hmsetAsync(set ,key, stringifyValue);
    }

    async del(set, key) {
        return this.client.hdel(set, key);
    }

};

module.exports = DB;