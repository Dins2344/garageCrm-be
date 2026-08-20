#!/bin/bash
# ─────────────────────────────────────────────────────
# GaragePulse — EC2 Instance Setup Script
# Run this ONCE on a fresh Ubuntu 22.04/24.04 EC2 instance
# Usage: chmod +x setup-ec2.sh && sudo ./setup-ec2.sh
# ─────────────────────────────────────────────────────

set -e

echo "══════════════════════════════════════════"
echo "   GaragePulse EC2 Setup Script"
echo "══════════════════════════════════════════"

# 1. System update
echo "Updating system packages..."
apt-get update && apt-get upgrade -y

# 2. Install Docker
echo "Installing Docker..."
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 3. Add current user to docker group
echo "Adding user to docker group..."
usermod -aG docker ubuntu

# 4. Setup project directories
echo "Creating project directories..."
mkdir -p /home/ubuntu/garagepulse/nginx/ssl
mkdir -p /home/ubuntu/deploy
chown -R ubuntu:ubuntu /home/ubuntu/garagepulse /home/ubuntu/deploy

# 5. Enable Docker to start on boot
systemctl enable docker
systemctl start docker

# 6. Setup firewall
echo "Configuring firewall..."
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw --force enable

# 7. Setup swap (useful for t2.micro/t3.micro)
echo "Setting up swap space..."
if [ ! -f /swapfile ]; then
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo ""
echo "══════════════════════════════════════════"
echo "   Setup Complete!"
echo "══════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Log out and back in (for docker group)"
echo "  2. Create .env.production in ~/garagepulse/"
echo "  3. Push to GitHub main branch to trigger deploy"
echo ""
