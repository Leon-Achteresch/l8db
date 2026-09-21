FROM alpine:3.23
RUN apk add --no-cache openssh && mkdir -p /root/.ssh && chmod 700 /root/.ssh && echo 'root:sshtestpw' | chpasswd && ssh-keygen -A
RUN printf 'PermitRootLogin yes\nPasswordAuthentication yes\nAllowTcpForwarding yes\n' > /etc/ssh/sshd_config.d/lab.conf
CMD ["/usr/sbin/sshd", "-D", "-e"]
