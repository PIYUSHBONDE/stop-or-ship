# The immutable base contains the exact evaluated source and locked dependencies.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
USER root
COPY --chown=10001:10001 release/*.json /app/release/
USER 10001:10001
