`docker run --name redis -v ~/sources/wallet-value/redis_data:/data -p 6379:6379  -d redis redis-server --appendonly yes`