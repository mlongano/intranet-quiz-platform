# QuizParty

## Overview

A self-contained quiz application designed for secure, offline classroom assessments. This system runs entirely on a
local area network (LAN) without requiring internet access, making it ideal for controlled testing environments in
schools and educational institutions.

**Key Features:**

- **Offline Operation**: Fully functional without internet connectivity - perfect for exam scenarios
- **No External Dependencies**: All data stored locally; no cloud services or external APIs required
- **Multiple Question Types**: Supports single choice, multiple choice, and open-ended questions with optional images
- **Automatic Grading**: Instant scoring for closed questions; keyword-based or LLM-powered scoring for open responses
- **Admin Dashboard**: Real-time monitoring, score management, and result distribution via email
- **Fair Randomization**: Questions and answer options are shuffled once per student to prevent cheating while
  maintaining consistency
- **Data Integrity**: Automatic backups, atomic file locking, and score recalculation capabilities
- **Modern UI**: Dark-first design system with light/dark/system theme toggle, responsive layout, and smooth animations
- **Accessibility**: Floating accessibility panel for font size, text spacing, dyslexia font, and contrast adjustments
- **LLM Evaluation**: Optional AI-powered grading of open-ended answers using any supported LLM provider

**Typical Use Case:** A teacher sets up the server on a local machine, students connect via LAN (e.g., classroom WiFi
or wired network), take their quizzes on their own devices, and results are instantly available to the instructor.
Optional email functionality can be configured if internet access is available after the exam.

## Directory layout

```sh
local-quizzies/        # project root directory
│
├─ server.py           # Flask server (Waitress WSGI, port 5001)
├─ utils.py            # Utility library (file ops, atomic writes, slugify, caching)
├─ llm_evaluator.py    # LLM-based open question evaluator
├─ email_service.py    # Email sending logic
├─ git_sync.py         # Git-based cloud sync for banks
├─ pyproject.toml      # Python dependencies (uv)
│
├─ routes/
│  ├─ quiz.py          # /api/start, /api/submit, /api/question, /api/resume
│  └─ admin.py         # All /api/admin/* endpoints
│
├─ frontend/           # React + TypeScript frontend (Vite)
│  └─ src/
│     ├─ pages/        # 14 page components (admin + student)
│     ├─ components/   # Shared components (AccessibilityPanel, ThemeToggle, …)
│     ├─ layouts/      # AdminLayout (collapsible sidebar + sticky header)
│     ├─ hooks/        # Custom hooks (useAccessibility, …)
│     └─ lib/          # Utilities (theme.ts, utils.ts)
│
├─ questions.jsonc     # Active quiz (with answers & weights)
├─ scores.jsonc        # Active submissions
├─ students.jsonc      # Enrolled student list
├─ quiz_status.jsonc   # Quiz enable/disable state
│
├─ quizzes/            # Auto-generated; one file per live quiz session
│
├─ banks/              # All banks in one directory for cloud sync
│  ├─ question_bank/   # Saved question sets (.jsonc)
│  ├─ scores_bank/     # Score archives (.jsonc)
│  └─ students_bank/   # Student list archives (.jsonc)
│
└─ images/             # Uploaded images for questions and answers
```

`quizzes/` is created automatically; each student that starts a quiz gets a file like `student@email.com.json`
describing only the randomised order of that quiz for that student.

## Install instructions

### Prerequisites

**Check Python Installation:**

QuizParty requires Python 3.10 or higher. Check if Python is installed:

```bash
# Check Python version
python --version
# or
python3 --version
```

If Python is not installed or the version is below 3.10, install Python:

- **Windows**: Download from [python.org](https://www.python.org/downloads/) or use [Microsoft Store](https://apps.microsoft.com/detail/9ncvdn91xzqp)
- **macOS**: Use Homebrew: `brew install python@3.12`
- **Linux**: Use your package manager: `sudo apt install python3.12` (Ubuntu/Debian) or `sudo dnf install python3.12` (Fedora)

#### Optional: Install Latest Python Version

For best performance and latest features, install Python 3.12 or higher:

```bash
# macOS with Homebrew
brew install python@3.12

# Ubuntu/Debian
sudo apt update
sudo apt install python3.12

# Fedora
sudo dnf install python3.12

# Windows - Download installer from python.org
# Make sure to check "Add Python to PATH" during installation
```

#### Install Node.js

Install **Node.js** (v18 or higher) following the [official instructions](https://nodejs.org/) for your operating system.

```bash
# Check Node.js version
node --version
```

### Clone the Repository

```sh
git clone https://github.com/mlongano/intranet-quiz-manager.git
cd intranet-quiz-manager
```

### Install Dependencies

#### Windows

**Install uv (Python package manager):**

```powershell
powershell.exe -ExecutionPolicy Bypass -Command '
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy
Invoke-RestMethod "https://astral.sh/uv/install.ps1" | Invoke-Expression
'

$NewPath = "$($env:USERPROFILE)\.local\bin;$($env:Path)"
[Environment]::SetEnvironmentVariable("Path", $NewPath, [System.EnvironmentVariableTarget]::User)
```

**Install pnpm (Node.js package manager) - Recommended:**

```powershell
powershell.exe -ExecutionPolicy Bypass -Command '
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy
Invoke-WebRequest https://get.pnpm.io/install.ps1 -UseBasicParsing | Invoke-Expression
'

$NewPath = "$($env:Path);$($env:LOCALAPPDATA)\pnpm"
[Environment]::SetEnvironmentVariable("Path", $NewPath, [System.EnvironmentVariableTarget]::User)
[Environment]::SetEnvironmentVariable("PNPM_HOME", "$($env:LOCALAPPDATA)\pnpm", [System.EnvironmentVariableTarget]::User)
```

**Note:** You may need to restart your terminal or PowerShell after installation.

#### Linux and macOS

**Install uv:**

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**Install pnpm:**

```bash
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

Or use npm if you prefer:

```bash
npm install -g pnpm
```

### Configuration

#### 1. Create Environment File

Create a `.env` file in the project root (you can copy from `.env.example`):

```sh
# Required: Admin password for accessing admin panel
ADMIN_PW=your-secure-password-here

# Optional: Email configuration for sending quiz results to students
# If not configured, email functionality will be disabled
EMAIL_SENDER=your.email@example.com
EMAIL_PASSWORD=your_app_password_here
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587

# Optional: Cloud sync configuration (Git-based backup)
# BANKS_GIT_REMOTE=https://github.com/yourusername/quiz-banks.git
# BANKS_GIT_TOKEN=your_github_personal_access_token

# Optional: LLM-based evaluation of open questions
# USE_LLM_EVAL=1
# LLM_MODEL=gpt-4o-mini          # default; any model supported by installed llm plugin
# LLM_RETRIES=2
# LLM_BACKOFF_FACTOR=0.5
```

#### Email Configuration (Optional)

To enable email functionality for sending quiz results to students:

1. **[For Gmail users:](./EMAIL_SETUP.md)**
   - Enable 2-factor authentication on your Google account
   - Generate an App Password at <https://myaccount.google.com/apppasswords>
   - Use the generated 16-character password as `EMAIL_PASSWORD`
   - Set `EMAIL_SENDER` to your Gmail address

2. **For other email providers:**
   - Set `SMTP_SERVER` to your provider's SMTP server
   - Set `SMTP_PORT` to the appropriate port (usually 587 for TLS)
   - Set `EMAIL_SENDER` to your email address
   - Set `EMAIL_PASSWORD` to your email password or app-specific password

**Note:** Email addresses in `students.jsonc` will be used as recipient addresses when sending quiz results.

#### 2. Create Students File

create a `students.jsonc` file with the email addresses of students who will take the quiz:

```jsonc
[
  "name@example.com",
  "name1@example.com",
  ...
]
```

**Students Format Options:**

The `students.jsonc` file supports three flexible formats:

1. **Simple format** (email strings only):

   ```jsonc
   [
     "student1@example.com",
     "student2@example.com"
   ]
   ```

2. **Individual format** (with optional groups):

   ```jsonc
   [
     { "email": "student1@example.com", "group": "5CI" },
     { "email": "student2@example.com", "group": "4BI" }
   ]
   ```

3. **Group format** (multiple students in same group):

   ```jsonc
   [
     {
       "group": "5CI",
       "emails": [
         "student1@example.com",
         "student2@example.com"
       ]
     },
     {
       "group": "4BI",
       "emails": ["student3@example.com"]
     }
   ]
   ```

You can mix all three formats in the same file. The group field is useful for organizing students by class or section in the admin panel.

#### 3. Create Questions File

create a `questions.jsonc` file to store your quiz questions:

```jsonc
{
  "title": "General Knowledge Quiz 2025",  // Required: Add a title for your quiz
  "questions": [
    {
      "id": 1,
      "type": "single",
      "text": "Capital of France?",
      "options": ["Paris", "Rome", "Madrid", "Berlin"],
      "correct": 0,
      "weight": 1,
    },
    {
      "id": 2,
      "type": "multiple",
      "text": "Select the prime numbers:",
      "question_image": "test/question1.jpeg",
      "options": [
        {
          "text": "2",
          "image": "test/option1a.jpeg",
        },
        {
          "text": "4",
          "image": "test/option1b.jpeg",
        },
        {
          "text": "5",
          "image": "test/option1c.jpeg",
        },
        {
          "text": "9",
          "image": "test/option1d.jpeg",
        },
      ],

      "correct": [0, 2],
      "weight": 2,
    },
    {
      "id": "q7",
      "type": "open",
      "text": "Which gas do plants release during photosynthesis?",
      "question_image": "test/question2.jpeg",
      "options": [],
      "weight": 2,
      "acceptable": ["oxygen", "o2"],
    },
    {
      "id": "q8",
      "type": "open",
      "text": "Name three noble gases.",
      "options": [],
      "weight": 4,
      "keywords": ["helium", "neon", "argon", "krypton", "xenon", "radon"],
      "min_keywords": 3, // get full points when ≥ 3 found
    },
  ]
}
```

**Important Format Requirements:**

- The file **must** be an object with `"title"` and `"questions"` fields
- The old array format (without wrapping object) is **no longer supported**
- When saving to the question bank or scores bank, the system will use the slugified title for the filename
  - Example: "General Knowledge Quiz 2025" → `general-knowledge-quiz-2025.jsonc`

### Running the Application

#### Development Mode (for testing and development)

**Start the backend server:**

```sh
uv run server.py
```

The server will start on `http://localhost:5001` (accessible on your LAN).

**In a new terminal, start the frontend development server:**

```sh
cd frontend
pnpm install
pnpm dev
```

The frontend dev server runs on `http://localhost:5173` with hot-reload.

#### Production Mode (recommended for actual quizzes)

**Build the frontend:**

```sh
cd frontend
pnpm install
pnpm build
```

This compiles the React app and copies it to the backend's static folder.

**Start the server:**

```sh
uv run server.py
```

Now the backend serves both the API and the frontend at `http://localhost:5001`.

**Access the application:**

- **Students**: Navigate to `http://your-server-ip:5001/` to start the quiz
- **Admin**: Navigate to `http://your-server-ip:5001/admin` to access the admin panel

**Finding your server IP:**

- The server will display all available addresses when it starts
- Students on the same network can access using your local IP (e.g., `http://192.168.1.100:5001`)

## Production Deployment on Ubuntu 22.04

For production use in a classroom/school environment, here are three deployment options:

### Option 1: Systemd Service with Nginx (Recommended)

This is the most robust solution for a school environment with automatic restart, proper logging, and production-grade performance.

#### 1. Install System Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Python 3.12 (or latest)
sudo apt install python3.12 python3.12-venv python3-pip -y

# Install Node.js 20+ (for building frontend)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs -y

# Install pnpm
npm install -g pnpm

# Install nginx (for production serving)
sudo apt install nginx -y
```

#### 2. Setup Application

```bash
# Clone/copy your application
cd /opt
sudo git clone https://github.com/your-username/your-repo.git quizparty
cd quizparty

# Set proper ownership
sudo chown -R $USER:$USER /opt/quizparty

# Install uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install Python dependencies
uv venv
source .venv/bin/activate
uv pip install flask werkzeug python-dotenv

# Build frontend
cd frontend
pnpm install
pnpm run build
cd ..

# Create .env file
nano .env
# Add your configuration:
# ADMIN_PW=your_secure_password
# SMTP_SERVER=smtp.gmail.com (if using email)
# SMTP_PORT=587
# SMTP_USER=your_email@gmail.com
# SMTP_PASSWORD=your_app_password
# etc.

# Create students.jsonc and questions.jsonc files
```

#### 3. Create Systemd Service

```bash
# Create service file
sudo nano /etc/systemd/system/quizparty.service
```

Add the following content:

```ini
[Unit]
Description=QuizParty Quiz Application
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/quizparty
Environment="PATH=/opt/quizparty/.venv/bin"
ExecStart=/opt/quizparty/.venv/bin/python server.py
Restart=always
RestartSec=10

# Security
NoNewPrivileges=true
PrivateTmp=true

# Logging
StandardOutput=append:/var/log/quizparty/access.log
StandardError=append:/var/log/quizparty/error.log

[Install]
WantedBy=multi-user.target
```

```bash
# Create log directory
sudo mkdir -p /var/log/quizparty
sudo chown www-data:www-data /var/log/quizparty

# Set proper permissions
sudo chown -R www-data:www-data /opt/quizparty

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable quizparty
sudo systemctl start quizparty
sudo systemctl status quizparty
```

#### 4. Configure Nginx as Reverse Proxy

```bash
sudo nano /etc/nginx/sites-available/quizparty
```

Add the following configuration:

```nginx
server {
    listen 80;
    server_name quiz.local;  # or your server IP/domain

    # Increase upload size for images
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (for future features)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_header_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Serve static files directly (optional optimization)
    location /static/ {
        alias /opt/quizparty/static/;
        expires 1d;
        add_header Cache-Control "public, immutable";
    }

    location /banks/ {
        alias /opt/quizparty/banks/;
        expires 1d;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/quizparty /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 5. Firewall Configuration

```bash
# Allow HTTP traffic only from local network
sudo ufw allow 80/tcp
sudo ufw allow from 192.168.1.0/24 to any port 80  # Adjust subnet to your network
sudo ufw enable
sudo ufw status
```

#### 6. Management Commands

```bash
# View live logs
sudo journalctl -u quizparty -f

# Restart service
sudo systemctl restart quizparty

# Stop service
sudo systemctl stop quizparty

# Check status
sudo systemctl status quizparty

# View last 100 log lines
sudo journalctl -u quizparty -n 100
```

---

### Option 2: Screen Session (Quick Setup)

For quick testing or temporary classroom use without full systemd setup:

```bash
# Install screen
sudo apt install screen -y

# Navigate to application directory
cd /path/to/quizparty

# Activate virtual environment
source .venv/bin/activate

# Start app in screen session
screen -S quizparty
python server.py

# Detach from screen: Press Ctrl+A, then D
# The app continues running in the background

# To reattach later
screen -r quizparty

# To list all screen sessions
screen -ls

# To kill the session
screen -S quizparty -X quit
```

**Note**: This method won't auto-restart on failure or survive system reboots. Good for testing only.

---

### Option 3: Docker Deployment

If you prefer containerization:

#### 1. Create Dockerfile

Create a `Dockerfile` in the project root:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# Install Node.js for building frontend
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g pnpm && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy application files
COPY . .

# Build frontend
RUN cd frontend && pnpm install && pnpm run build && cd ..

# Install Python dependencies
RUN pip install --no-cache-dir uv && \
    uv venv && \
    uv pip install flask werkzeug python-dotenv

# Create necessary directories
RUN mkdir -p banks/question_bank banks/scores_bank banks/students_bank

EXPOSE 5001

# Run with virtual environment
CMD [".venv/bin/python", "server.py"]
```

#### 2. Create docker-compose.yml

```yaml
version: '3.8'

services:
  quizparty:
    build: .
    container_name: quizparty
    ports:
      - "80:5001"  # Map container port 5001 to host port 80
    volumes:
      # Persist data directories
      - ./banks:/app/banks
      - ./scores.jsonc:/app/scores.jsonc
      - ./students.jsonc:/app/students.jsonc
      - ./questions.jsonc:/app/questions.jsonc
      - ./quiz_status.jsonc:/app/quiz_status.jsonc
    env_file:
      - .env
    restart: unless-stopped
    networks:
      - quizparty-network

networks:
  quizparty-network:
    driver: bridge
```

#### 3. Deploy with Docker

```bash
# Install Docker and Docker Compose
sudo apt update
sudo apt install docker.io docker-compose -y
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# Log out and back in for group changes to take effect

# Build and start container
docker-compose up -d

# View logs
docker-compose logs -f

# Stop container
docker-compose down

# Restart container
docker-compose restart

# Rebuild after code changes
docker-compose up -d --build
```

---

### Production Best Practices

Regardless of deployment method:

1. **Security**:
   - Use strong admin password in `.env`
   - Restrict firewall to local network only
   - Keep system and dependencies updated
   - Never commit `.env` file to git

2. **Backups**:

   ```bash
   # Create backup script
   sudo nano /usr/local/bin/backup-quizparty.sh
   ```

   ```bash
   #!/bin/bash
   BACKUP_DIR="/backups/quizparty"
   DATE=$(date +%Y%m%d_%H%M%S)
   mkdir -p $BACKUP_DIR
   tar -czf $BACKUP_DIR/quizparty_$DATE.tar.gz -C /opt/quizparty banks/ scores.jsonc students.jsonc questions.jsonc
   # Keep only last 30 days of backups
   find $BACKUP_DIR -name "quizparty_*.tar.gz" -mtime +30 -delete
   ```

   ```bash
   sudo chmod +x /usr/local/bin/backup-quizparty.sh
   # Add to crontab (daily at 2 AM)
   sudo crontab -e
   # Add line: 0 2 * * * /usr/local/bin/backup-quizparty.sh
   ```

3. **Monitoring**:

   ```bash
   # Check service health
   sudo systemctl status quizparty

   # Monitor resource usage
   sudo apt install htop -y
   htop
   ```

4. **Log Rotation**:

   ```bash
   sudo nano /etc/logrotate.d/quizparty
   ```

   ```
   /var/log/quizparty/*.log {
       daily
       rotate 7
       compress
       delaycompress
       missingok
       notifempty
       create 0640 www-data www-data
   }
   ```

### Recommended Choice

For a **school/classroom environment**, we recommend **Option 1 (Systemd + Nginx)** because:

- ✅ Automatic restart on failure
- ✅ Starts automatically on system boot
- ✅ Better performance (Nginx handles static files efficiently)
- ✅ Proper logging and monitoring
- ✅ Easy to manage and troubleshoot
- ✅ Production-ready and stable
- ✅ No additional overhead (unlike Docker)

**Option 2 (Screen)** is best for quick testing or temporary use.

**Option 3 (Docker)** is ideal if you're already using containers or need easy portability.

---

## Adding HTTPS/SSL for LAN Deployment

For secure connections (HTTPS) on your local network, you have two main options:

### Option A: Self-Signed Certificate (Easiest for LAN)

Best for isolated classroom/school networks where you control all client devices.

#### 1. Generate Self-Signed Certificate

```bash
# Create directory for certificates
sudo mkdir -p /etc/ssl/quizparty
cd /etc/ssl/quizparty

# Generate private key and certificate (valid for 365 days)
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout quizparty.key \
  -out quizparty.crt \
  -subj "/C=IT/ST=YourState/L=YourCity/O=YourSchool/CN=quiz.local"

# Set proper permissions
sudo chmod 600 quizparty.key
sudo chmod 644 quizparty.crt
```

**Alternative with Subject Alternative Names (for multiple hostnames/IPs):**

```bash
# Create OpenSSL config file
sudo nano /etc/ssl/quizparty/openssl.cnf
```

Add the following content (adjust IPs and names to match your setup):

```ini
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
C=IT
ST=YourState
L=YourCity
O=YourSchool
CN=quiz.local

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = quiz.local
DNS.2 = quiz
DNS.3 = localhost
IP.1 = 192.168.1.100
IP.2 = 127.0.0.1
```

```bash
# Generate certificate with config
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/quizparty/quizparty.key \
  -out /etc/ssl/quizparty/quizparty.crt \
  -config /etc/ssl/quizparty/openssl.cnf \
  -extensions v3_req
```

#### 2. Update Nginx Configuration

```bash
sudo nano /etc/nginx/sites-available/quizparty
```

Replace the content with:

```nginx
# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name quiz.local 192.168.1.100;  # Add your server IP
    return 301 https://$server_name$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name quiz.local 192.168.1.100;  # Add your server IP

    # SSL certificate
    ssl_certificate /etc/ssl/quizparty/quizparty.crt;
    ssl_certificate_key /etc/ssl/quizparty/quizparty.key;

    # SSL configuration (modern security settings)
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Increase upload size for images
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_header_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Serve static files directly
    location /static/ {
        alias /opt/quizparty/static/;
        expires 1d;
        add_header Cache-Control "public, immutable";
    }

    location /banks/ {
        alias /opt/quizparty/banks/;
        expires 1d;
    }
}
```

```bash
# Test and restart Nginx
sudo nginx -t
sudo systemctl restart nginx

# Update firewall to allow HTTPS
sudo ufw allow 443/tcp
sudo ufw allow from 192.168.1.0/24 to any port 443
```

#### 3. Distribute Certificate to Client Devices

Students will see a browser warning since the certificate is self-signed. You have two options:

##### Option 3a: Click Through Warning (Quick but annoying)

- Students click "Advanced" → "Proceed to quiz.local (unsafe)"
- Must be done once per browser/device

##### Option 3b: Install Certificate on All Devices (Best UX)

**For Windows:**

```powershell
# Copy quizparty.crt to students' machines, then:
# 1. Double-click the certificate file
# 2. Click "Install Certificate"
# 3. Select "Local Machine" → Next
# 4. Choose "Place all certificates in the following store"
# 5. Click "Browse" → Select "Trusted Root Certification Authorities"
# 6. Click OK → Next → Finish
```

**For macOS:**

```bash
# Copy quizparty.crt to students' machines, then:
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain quizparty.crt
```

**For Linux (Ubuntu/Debian):**

```bash
# Copy quizparty.crt to students' machines, then:
sudo cp quizparty.crt /usr/local/share/ca-certificates/quizparty.crt
sudo update-ca-certificates
```

**For iOS/iPadOS:**

1. Email or AirDrop the `.crt` file to devices
2. Open the file → Install profile
3. Go to Settings → General → About → Certificate Trust Settings
4. Enable full trust for the certificate

**For Android:**

1. Copy `.crt` file to device
2. Settings → Security → Install from storage
3. Select the certificate file

---

### Option B: Let's Encrypt with Local DNS (More Complex but Trusted)

This requires setting up a local DNS server and having a real domain name. Best for schools with IT infrastructure.

#### Prerequisites

- A domain name you own (e.g., `school.edu`)
- Local DNS server (dnsmasq or similar)
- Port 80/443 accessible from your LAN

#### 1. Setup Local DNS

```bash
# Install dnsmasq
sudo apt install dnsmasq -y

# Configure dnsmasq
sudo nano /etc/dnsmasq.conf
```

Add:

```text
address=/quiz.school.edu/192.168.1.100  # Your server IP
```

```bash
sudo systemctl restart dnsmasq

# Configure students' devices to use this DNS server
# Point their DNS to your server IP (192.168.1.100)
```

#### 2. Get Let's Encrypt Certificate (using DNS challenge)

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx -y

# Request certificate (requires DNS TXT record access)
sudo certbot certonly --manual --preferred-challenges dns -d quiz.school.edu

# Follow prompts to add DNS TXT records to your domain
# Certbot will verify ownership and issue certificate
```

#### 3. Update Nginx to Use Let's Encrypt Certificate

```bash
sudo nano /etc/nginx/sites-available/quizparty
```

Update SSL certificate paths:

```nginx
```

Update SSL certificate paths:

```nginx
ssl_certificate /etc/letsencrypt/live/quiz.school.edu/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/quiz.school.edu/privkey.pem;
```

#### 4. Setup Auto-Renewal

```bash
# Test renewal
sudo certbot renew --dry-run

# Certbot installs auto-renewal via systemd timer
sudo systemctl status certbot.timer
```

---

### Option C: mkcert (Development Tool - Easy but Requires Installation on All Devices)

Best for development or small deployments where you can install mkcert on all machines.

#### 1. Install mkcert on Server

```bash
# Install mkcert
sudo apt install libnss3-tools -y
wget https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v*-linux-amd64
sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert
sudo chmod +x /usr/local/bin/mkcert

# Install local CA
mkcert -install

# Generate certificate
cd /etc/ssl/quizparty
sudo mkcert -key-file quizparty.key -cert-file quizparty.crt quiz.local 192.168.1.100 localhost 127.0.0.1
```

#### 2. Install mkcert CA on Student Devices

```bash
# Get the CA certificate
cat "$(mkcert -CAROOT)/rootCA.pem"

# Copy this certificate to all student devices and install it
# (Follow same installation steps as Option A, Option 3b)
```

---

### Testing HTTPS Setup

```bash
# Test certificate
openssl s_client -connect quiz.local:443 -showcerts

# Check Nginx SSL configuration
sudo nginx -t

# View SSL certificate details
openssl x509 -in /etc/ssl/quizparty/quizparty.crt -text -noout

# Test from another machine
curl -k https://192.168.1.100  # -k to skip certificate verification
```

### Recommendations

| Method | Best For | Pros | Cons |
|--------|----------|------|------|
| **Self-Signed** | Isolated classroom networks | Easy, no external dependencies | Browser warnings unless cert installed on all devices |
| **Let's Encrypt** | Schools with domain + IT staff | Trusted by browsers | Requires domain name, DNS setup, more complex |
| **mkcert** | Development, small deployments | Easy to use, trusted locally | Requires tool installation on all devices |

**For most school scenarios, we recommend Self-Signed Certificate (Option A, Option 3b)** - generate once, install on all school devices via MDM or manual installation, then it works seamlessly for all students.

## Features

### Student Features

- **Quiz Taking**: Students log in with their email (must be in `students.jsonc`) and take randomized quizzes
- **Question Types**: Supports single choice, multiple choice, and open-ended questions
- **Images**: Questions and answer options can include images
- **Auto-save**: Quiz progress is automatically saved server-side
- **Resume**: Students can resume incomplete quizzes from where they left off (stale plans are auto-detected and discarded)
- **Accessibility Panel**: Floating toolbar (on quiz pages) with controls for font size, text spacing, dyslexia-friendly font, and high-contrast modes. Settings persist in `localStorage`.
- **Theme Support**: Students can switch between light, dark, and system theme via the top-bar toggle

### Admin Features

Access the admin panel at `/admin` with the password set in `.env`:

- **Quiz Control**: Enable/disable quiz access for students
  - Toggle switch in dashboard header for quick access
  - Visual green (enabled) / red (disabled) indicator
  - Prevents students from starting or accessing quizzes when disabled
  - Friendly message shown to students when quiz is disabled
- **Dashboard**: Animated overview with real-time statistics
  - Animated StatCards (framer-motion) showing live quiz, student, and score counts
  - Clickable statistics cards for quick navigation
  - Current quiz info with question count
  - Auto-refreshing submissions tracker (30-second countdown)
  - Click submission counts to view submitted/pending students
  - Students count with quick access to management
  - Archive overview with split counts (questions/scores/students)
  - Cloud Sync button integrated in Archives card
- **Admin Layout**: Collapsible sidebar with sticky header
  - Collapsible sidebar (expand/collapse with toggle)
  - Sticky frosted-glass header with page title and theme toggle
  - Expandable "Archives" navigation section for bank pages
  - ThemeToggle in header (light / dark / system)
  - Customisable page title gradient colour per page
- **Image Management**: Dedicated image management system
  - Upload images via drag-and-drop interface
  - Support for PNG, JPG, JPEG, GIF, WEBP (max 5MB per file)
  - Visual gallery with preview and delete functionality
  - Quiz-specific image organization
  - Images automatically saved/loaded with quiz from bank
  - Clear all images with inline confirmation
  - Integrated image picker in question editor
- **View Scores**: See all submitted quiz results with timestamps and percentages
- **Scores Bank Review**: Review archived score files with inline editing
- **Export CSV**: Export all scores to CSV format with smart filenames (date + quiz title)
- **View Details**: Click any submission to see detailed question-by-question results
- **Recalculate Scores**: Re-grade all submissions against updated question bank (with inline confirmation)
- **LLM Re-grade**: Re-evaluate open questions in the scores bank using a configured LLM model
- **Clear/Restore Scores**: Clear all scores with backup, restore from backup (with inline confirmation)
- **Send Emails**:
  - Send individual quiz results to specific students
  - Bulk send results to all students
  - Customize email subject with inline validation and improved defaults
  - Choose to include or exclude detailed question-by-question breakdown
  - No browser alerts - all errors shown inline
- **Question Management**: Edit questions, answers, and weights via JSONC editor
  - Sticky question editor toolbar for easy access while scrolling
  - Integrated image picker for adding images to questions/answers
  - Image count display in editor header
  - Toast notifications for all operations
  - Bank edit mode: edit bank files in-place without loading them into the active quiz
  - Title colour customisation per page
- **Students Management**:
  - Edit student list via JSONC editor with live preview
  - Email validation with visual indicators
  - Support for simple emails, individual entries with groups, or group format
  - Preview students grouped by class/section
  - Save/load student lists from students bank for different classes
  - Delete student files from bank with inline confirmation
- **Bank Management**:
  - **Question Bank**: Save/load/edit question sets for different quizzes with delete and rename functionality
    - Edit bank files directly using the full question editor without affecting the active quiz
  - **Scores Bank**: Archive and restore quiz results with delete and rename functionality
  - **Students Bank**: Save/load student lists with delete, rename, and load confirmations
  - All bank operations use inline confirmations (no browser alerts)
  - Smart filenames with date prefix and slugified quiz titles

### Automatic Features

- **Shuffle Prevention**: Each student's answer options are shuffled once and saved to prevent re-randomization
- **Score Backup**: Automatic timestamped backups before recalculation
- **Atomic File Locking**: Thread-safe file operations with `filelock` and temp-file-then-rename pattern — prevents data corruption under concurrent load (up to 6 threads, exponential-backoff retry)
- **Question Caching**: In-memory question cache with mtime invalidation to reduce disk I/O
- **Dynamic Student Loading**: Student list auto-reloads when the file changes on disk (no server restart needed)

## Design System & Theming

QuizParty uses a **dark-first CSS design token system** introduced in v2.3.0.

### Design Tokens

All colours, typography, and spacing are defined as CSS custom properties (variables) and are consumed through Tailwind CSS utility classes. The token system supports three modes:

- **Dark** — default, low-contrast backgrounds with saturated accents
- **Light** — clean white surfaces with muted palette
- **System** — follows the OS `prefers-color-scheme` media query (auto-switches)

Theme mode is stored in `localStorage` under the key `qp-theme` and applied immediately on page load via `initTheme()` (called in `main.tsx` before the React tree mounts, preventing FOUC).

### ThemeToggle

The `ThemeToggle` component is embedded in:
- The sticky admin header (all admin pages via `AdminLayout`)
- Student-facing pages (StartPage, QuizPage, FinishPage)

It presents three icon buttons (Monitor / Sun / Moon) for system / light / dark.

### Accessibility Panel

The `AccessibilityPanel` component is a floating toolbar available on **student-facing pages only** (StartPage and QuizPage). It provides:

| Setting | Options |
|---------|---------|
| Font Size | A- (default) · A · A+ · A++ |
| Spacing | Normal · Wide · Loose |
| Font Family | Normal · Dyslexia (OpenDyslexic) |
| Contrast | Normal · High · Yellow-on-black |

Settings persist in `localStorage`. A dot indicator on the panel button shows when any non-default setting is active. A "Reset all" button restores defaults.

### Typography & Fonts

Google Fonts are loaded at build time:
- **Display / Headline**: used for page titles and card headings
- **Body**: used for navigation labels and UI text
- **Monospace**: used in the JSONC editor

---

## LLM Evaluation

QuizParty supports optional **AI-powered grading** of open-ended questions via the [`llm`](https://llm.datasette.io/) Python library.

### How It Works

When `USE_LLM_EVAL=1` is set in `.env`, open questions are evaluated by an LLM instead of (or in addition to) simple keyword matching. The evaluator:

1. Sends the question text, student answer, and correct answers to the configured model
2. Receives a structured JSON response: `{ "score": float, "verdict": string, "llm_feedback": string }`
3. Assigns partial credit proportionally (0.0 – 1.0)
4. Stores the `llm_feedback` field alongside the score for display in the admin panel

The system prompt enforces **semantic equivalence** grading — not superficial keyword matching.

### Configuration

Add to `.env`:

```bash
# Enable LLM evaluation
USE_LLM_EVAL=1

# Model to use (default: gpt-4o-mini)
# Must be supported by an installed llm plugin
LLM_MODEL=gpt-4o-mini

# Optional: retry settings
LLM_RETRIES=2
LLM_BACKOFF_FACTOR=0.5
```

### Supported Providers

The `llm` library supports many providers via plugins. The following are pre-installed:

| Provider | Plugin | Example model |
|----------|--------|---------------|
| Anthropic | `llm-anthropic` | `claude-3-5-haiku-20241022` |
| DeepSeek | `llm-deepseek` | `deepseek-chat` |
| Ollama (local) | `llm-ollama` | `llama3.2`, `mistral` |

Configure API keys via the `llm` CLI:

```bash
# OpenAI (built-in)
uv run llm keys set openai

# Anthropic
uv run llm keys set anthropic

# Ollama (no key needed — runs locally)
# Just ensure Ollama is running: ollama serve
```

### LLM Re-grade from Admin

The Scores Bank Review page exposes an **LLM Re-grade** button that re-evaluates all open questions in a saved scores file against the current LLM model, without touching active scores.

---

## Admin Panel Usage

### Accessing Admin Panel

1. Navigate to `http://localhost:5001/admin` (or your server address)
2. Enter the admin password (set in `.env` as `ADMIN_PW`)
3. You'll be redirected to the admin dashboard

### Sending Quiz Results via Email

**Requirements**: Email must be configured in `.env` (see Email Configuration above)

**To send a single result:**

1. Go to the Scores page
2. Find the student's submission
3. Click the "📧 Email" button in that row
4. Enter the email subject (e.g., "Quiz Results - UF07-WEB")
5. Choose whether to include detailed question-by-question results
6. Click "Send Email"

**To send all results in bulk:**

1. Go to the Scores page
2. Click "📧 Email All Results" button at the top
3. Enter the email subject
4. Choose whether to include detailed results
5. Confirm to send to all students

**Email Content:**

- Summary with student name, quiz ID, score, percentage, and submission date
- Optional detailed breakdown showing each question, student's answer, correct answer, and points awarded
- Fully styled HTML email in Italian

### Recalculating Scores

If you need to update correct answers or question weights after students have submitted:

1. Edit the `questions.jsonc` file with updated answers/weights
2. Go to the Scores page in admin panel
3. Click "Recalculate All Scores" button
4. Confirm the action
5. All submissions will be re-graded automatically
6. A backup of old scores is saved to `scores_bank/` with timestamp

**Note**: The recalculation preserves each student's shuffled answer order, so scores are recalculated accurately.

### Managing Students

Access the Students page from the admin dashboard to manage your student list:

**Editing Students:**

1. Go to the Students page
2. Edit the JSONC directly in the editor
3. See live preview grouped by class/section
4. Email validation shows visual indicators (✓ for valid, ✗ for invalid)
5. Press Ctrl/Cmd+S or click "Save Changes" to update

**Using Students Bank:**

The Students Bank allows you to save and restore different student lists (e.g., for different classes or years):

1. **Save current students**: Go to Students Bank page, enter a filename, click "Save to Bank"
   - Default format: `YYYY-MM-DD_HH-MM_students.jsonc`
2. **Preview saved lists**: Click "Preview" on any saved file to see students grouped by class
3. **Load saved lists**: Click "Load" to restore a saved student list (backs up current list first)

**Supported Formats:**

- Simple email strings: `"student@example.com"`
- Individual with group: `{ "email": "student@example.com", "group": "5CI" }`
- Group with emails: `{ "group": "5CI", "emails": ["student1@...", "student2@..."] }`
- Mix all formats in the same file

**Benefits:**

- Organize students by class/section for better management
- Quickly switch between different classes or academic years
- Maintain multiple student lists without manual file editing
- Preview before loading to avoid mistakes

## Cloud Sync for Banks

QuizParty now supports cloud synchronization for all your banks (questions, scores, and students) using Git. This allows you to:

- **Backup all banks** to GitHub, GitLab, or any Git repository
- **Share banks** across multiple machines or with colleagues
- **Version control** your quiz data with full history
- **Sync automatically** from the admin dashboard

### Setting Up Cloud Sync

#### 1. Create a Git Repository

Create a new private repository on GitHub or GitLab (recommended to keep it private for student data).

**Example for GitHub:**

- Go to <https://github.com/new>
- Name: `quizparty-banks` (or any name you prefer)
- Select **Private** repository
- Do NOT initialize with README or .gitignore
- Copy the repository URL (e.g., `https://github.com/yourusername/quizparty-banks.git`)

#### 2. Generate a Personal Access Token

For GitHub:

- Go to <https://github.com/settings/tokens>
- Click "Generate new token (classic)"
- Name: `QuizParty Sync`
- Expiration: Choose "No expiration" or set a long duration (tokens can expire!)
- Select scope: **`repo`** (Full control of private repositories)
- Generate and copy the token (you won't see it again!)

For GitLab:

- Go to <https://gitlab.com/-/profile/personal_access_tokens>
- Name: `QuizParty Sync`
- Select scope: `write_repository`
- Create and copy the token

**Important**: Keep your token secure and never commit it to Git!

#### 3. Configure Environment Variables

Edit your `.env` file and add:

```sh
# Git Cloud Sync Configuration
BANKS_GIT_REMOTE=https://github.com/yourusername/quizparty-banks.git
BANKS_GIT_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Replace:

- `yourusername/quizparty-banks.git` with your repository URL
- `ghp_xxx...` with your personal access token

**Note**: `BANKS_GIT_USERNAME` is optional and only used for Git commit author name. The token alone is sufficient for authentication.

#### 4. Initialize and Sync

Restart the server to load the new configuration:

```sh
# Stop the server (Ctrl+C) and restart
uv run server.py
```

In the admin dashboard:

1. Go to the **Archives card** (in the statistics section)
2. Click **"☁️ Initialize Sync"** button at the bottom of the card (first time only)
3. From now on, click **"☁️ Sync to Cloud"** to synchronize all changes
4. The button shows the last commit timestamp for reference

### How It Works

- The `banks/` directory contains all three banks: `question_bank/`, `scores_bank/`, and `students_bank/`
- This directory has its own Git repository, separate from the main codebase
- When you sync:
  1. **Pull**: Gets latest changes from the cloud
  2. **Commit**: Saves your local changes
  3. **Push**: Uploads to the cloud repository

### Migration from Old Structure

If you have existing banks in the old structure (`question_bank/`, `scores_bank/`, `students_bank/` at the root), you need to migrate them to the new `banks/` directory.

**Automatic migration** (recommended):

Use the provided migration scripts:

```sh
# macOS/Linux
./migrate_banks.sh

# Windows (PowerShell)
.\migrate_banks.ps1
```

The scripts will:

- Create the `banks/` directory if it doesn't exist
- Move all files from old bank directories to `banks/question_bank/`, `banks/scores_bank/`, `banks/students_bank/`
- Remove empty old directories
- Warn you if files already exist in the destination

**Manual migration**:

If you prefer to migrate manually:

```sh
# macOS/Linux
mkdir -p banks
mv question_bank banks/
mv scores_bank banks/
mv students_bank banks/

# Windows (PowerShell)
New-Item -ItemType Directory -Force -Path banks
Move-Item question_bank banks/
Move-Item scores_bank banks/
Move-Item students_bank banks/
```

After migration, restart the server. Your banks will now be in the correct location and ready for cloud sync.

### Tips

- **Regular syncing**: Click "Sync to Cloud" in the Archives card to keep your cloud backup up to date
- **Multiple machines**: Set up the same repository on different computers to share banks
- **Privacy**: Keep your repository private if it contains student data
- **Token security**: Never commit your `.env` file or share your personal access token
- **Conflict resolution**: If changes conflict, the latest cloud version takes precedence (pull first)
- **Sync location**: The sync button is in the Archives card on the dashboard for easy access

## Troubleshooting

### Cloud Sync Issues

- **"Invalid username or token"**: Your GitHub token has expired or is invalid
  - Generate a new token at <https://github.com/settings/tokens>
  - Make sure to select the `repo` scope
  - Update `BANKS_GIT_TOKEN` in your `.env` file
  - Restart the server
- **"Authentication failed"**:
  - Verify your token is correct in the `.env` file
  - Make sure the token hasn't expired (set "No expiration" when creating)
  - Check that the repository URL is correct
- **Sync button not showing**:
  - Make sure `BANKS_GIT_REMOTE` and `BANKS_GIT_TOKEN` are set in `.env`
  - Restart the server to load new environment variables
  - Check browser console (F12) for error messages
- **"Pull failed" or "Push failed"**:
  - Check your internet connection
  - Verify the repository exists and you have access
  - Try manually: `cd banks && git remote -v` to see if remote is configured

### Email Issues

- **"Email service not configured"**: Make sure `EMAIL_SENDER` and `EMAIL_PASSWORD` are set in `.env`
- **"Authentication failed"**:
  - For Gmail: Make sure 2FA is enabled and you're using an App Password (not your regular password)
  - For other providers: Check that your SMTP credentials are correct
- **"Invalid email address"**: Ensure student emails in `students.jsonc` are valid email format
- **No emails received**: Check spam/junk folders; verify SMTP settings are correct for your provider

### Student Login Issues

- **"Unknown student"**: The student email must be listed in `students.jsonc` exactly as typed
- **Changes not taking effect**: The server auto-detects file changes via mtime caching — no restart needed after editing `students.jsonc` through the admin UI. If editing the file manually, changes should be picked up on the next quiz start.
- **Students file format error**: Make sure your `students.jsonc` uses one of the supported formats:
  - Simple strings: `["email@example.com", ...]`
  - Objects with email: `[{"email": "...", "group": "..."}, ...]`
  - Groups: `[{"group": "...", "emails": [...]}, ...]`

### Score Issues

- **Scores show as 0 or incorrect**: Use "Recalculate All Scores" to re-grade against current question bank
- **Missing option_order**: Run the backfill script if you have old scores before option tracking was added

## TODO Section

- [ ] access the admin endpoint only from localhost
- [ ] check if the resume is from the same pc
- [x] handle the comments in the jsonc files
- [x] Markdown support (implemented with react-markdown)
- [x] personalize the quiz for some student that has special needs (accessibility panel: font size, spacing, dyslexia font, contrast)
- [x] Email quiz results to students
- [x] Score recalculation against updated question bank
- [x] CSV export functionality
- [x] Question bank management and archiving
- [x] Add a title to the quiz set in `questions.jsonc` and show it in the admin panel and email
  (uses slugified title for filenames)
- [x] Manage student list from the admin panel with group support and email validation
- [x] Students bank for saving/loading different student lists
- [x] Quiz enable/disable control for administrators (toggle in dashboard header)
- [x] Image management system for questions and answers (upload, delete, integrated picker)
- [x] Replace all browser alerts with inline confirmation UI and toast notifications
- [x] Delete functionality for all bank types (questions, scores, students)
- [x] Rename functionality for all bank types (questions, scores, students)
- [x] Edit bank quiz files in-place without affecting the active quiz
- [x] Smart CSV export filenames with date and quiz title
- [x] Centralized utility functions (slugify) for code reusability
- [x] Add cloud backup support for scores, questions and students banks (Git-based sync implemented)
- [x] Design system overhaul: dark-first CSS tokens, Google Fonts, ThemeToggle (light/dark/system)
- [x] Admin UI redesign: collapsible sidebar, sticky header, animated StatCards (framer-motion)
- [x] Accessibility panel for student-facing pages (font size, spacing, dyslexia font, contrast)
- [x] LLM-based evaluation of open questions (`llm` library, pluggable providers)
- [x] Atomic file operations with retry and exponential backoff (prevent race conditions)
- [x] Dynamic student loading with mtime caching (no restart needed after edits)
- [x] Stale quiz plan detection and auto-discard on resume
- [x] Scores Bank Review page with inline editing and LLM re-grade
- [ ] Implement a timer for quizzes
- [ ] Improve error handling and user feedback throughout the app
- [ ] Internationalization (i18n) support
- [ ] Integration tests for backend and frontend components
- [ ] Dockerfile for easy deployment
- [ ] Documentation site with mkdocs
- [ ] Implement a feedback system for students
- [ ] Add support for more question types (e.g., matching, fill-in-the-blank)
- [ ] Use a database instead of JSONC files for better scalability

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

**What this means:**

- ✅ Free to use for educational institutions
- ✅ Modify and adapt to your needs
- ✅ Use in commercial settings (private schools, tutoring centers)
- ✅ No obligation to share your modifications
- ℹ️ Just keep the copyright notice
