SET CODEPATH=W:/DEV/CODE/zx-proxy
docker rmi cogsmith/zx-proxy
docker build -t cogsmith/zx-proxy %CODEPATH%