# Email Configuration Guide

## Setting up Gmail for Sending Quiz Results

### Step 1: Enable 2-Step Verification

1. Go to your Google Account: <https://myaccount.google.com/>
2. Navigate to **Security** in the left menu
3. Under "How you sign in to Google", click **2-Step Verification**
4. Follow the steps to enable it

### Step 2: Generate an App Password

1. After enabling 2-Step Verification, go back to **Security**
2. Under "How you sign in to Google", click **App passwords**
3. Select app: **Mail**
4. Select device: **Other (Custom name)** - enter "Quiz App"
5. Click **Generate**
6. Copy the 16-character app password (spaces are not required)

### Step 3: Configure .env File

Edit your `.env` file and add:

```env
# Email configuration for sending quiz results
EMAIL_SENDER=your-email@yourdomain.edu
EMAIL_PASSWORD=xxxx-xxxx-xxxx-xxxx  # Your app password from step 2
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
```

**Important:**

- Use your full Gmail address for `EMAIL_SENDER`
- Use the 16-character app password (not your regular Gmail password)
- For Google Workspace accounts, use your organization email

### Step 4: Testing

1. Restart your server
2. Go to Admin Scores page
3. Click "📧 Email All Results" to send to all students
4. Check the server logs for any errors

### Troubleshooting

#### Authentication Failed

- Make sure you're using an app password, not your regular password
- Verify 2-Step Verification is enabled
- Check that EMAIL_SENDER matches your Gmail address

#### Connection Timeout

- Check your firewall settings
- Verify SMTP_PORT is 587
- Try SMTP_PORT=465 with SSL (requires code modification)

#### Emails Not Received

- Check spam/junk folders
- Verify student emails are valid
- Check server logs for specific error messages

### Google Workspace Considerations

For Google Workspace for Education accounts:

- Admin must enable "Less secure app access" OR use OAuth2 (recommended for production)
- Current implementation uses app passwords (simpler for development)
- For production, consider implementing OAuth2 authentication

### Security Notes

- **Never commit .env file to git** (already in .gitignore)
- App passwords should be treated as secrets
- Revoke app passwords when no longer needed
- Consider using OAuth2 for production deployments
