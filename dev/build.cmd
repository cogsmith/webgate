SET CODEPATH=W:/DEV/CODE/hive-proxy
docker rmi cogsmith/hive-proxy
docker build -t cogsmith/hive-proxy %CODEPATH%