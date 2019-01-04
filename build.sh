#!/usr/bin/env bash

docker build -f ./Dockerfile -t gladis/humidity-temp-controll:latest .
docker push gladis/humidity-temp-controll:latest
kubectl delete pods --all