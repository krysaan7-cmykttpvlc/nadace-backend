const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendEmail({ to, subject, html }) {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
    });
  } catch (error) {
    console.error('Email send failed:', error.message);
  }
}

async function sendVerificationEmail(email, token) {
  const url = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  await sendEmail({
    to: email,
    subject: 'Ověření e-mailu - Nadace Pavelcových',
    html: `<p>Dobrý den,</p><p>pro dokončení registrace klikněte na tento odkaz:</p><p><a href="${url}">${url}</a></p><p>S pozdravem,<br>Nadace Inge a Miloše Pavelcových</p>`,
  });
}

async function sendStatusChangeEmail(email, firstName, status, note) {
  const statusMessages = {
    PENDING_REVIEW: 'Vaše registrace byla přijata a čeká na kontrolu.',
    INVITED_FOR_INTERVIEW: 'Byli jste pozváni k osobnímu pohovoru. Budeme vás kontaktovat s termínem.',
    APPROVED: 'Vaše registrace byla schválena. Nyní můžete podávat projekty a hlasovat.',
    REJECTED: `Vaše registrace byla zamítnuta.${note ? ' Důvod: ' + note : ''}`,
    BLOCKED: 'Váš účet byl zablokován.',
  };

  const message = statusMessages[status] || `Stav vaší registrace byl změněn na: ${status}`;

  await sendEmail({
    to: email,
    subject: 'Změna stavu registrace - Nadace Pavelcových',
    html: `<p>Dobrý den, ${firstName},</p><p>${message}</p><p>S pozdravem,<br>Nadace Inge a Miloše Pavelcových</p>`,
  });
}

async function sendInterviewInviteEmail(email, firstName, scheduledDate, interviewerName) {
  const date = new Date(scheduledDate);
  const formatted = date.toLocaleDateString('cs-CZ', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const time = date.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });

  await sendEmail({
    to: email,
    subject: 'Pozvánka k osobnímu pohovoru - Nadace Pavelcových',
    html: `
      <p>Dobrý den, ${firstName},</p>
      <p>byli jste pozváni k osobnímu pohovoru v rámci vaší registrace u Nadace Inge a Miloše Pavelcových.</p>
      <table style="border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:8px 16px;font-weight:bold;background:#f3f4f6;">Datum</td><td style="padding:8px 16px;background:#f3f4f6;">${formatted}</td></tr>
        <tr><td style="padding:8px 16px;font-weight:bold;">Čas</td><td style="padding:8px 16px;">${time}</td></tr>
        ${interviewerName ? `<tr><td style="padding:8px 16px;font-weight:bold;background:#f3f4f6;">Pohovorující</td><td style="padding:8px 16px;background:#f3f4f6;">${interviewerName}</td></tr>` : ''}
      </table>
      <p>Prosíme o potvrzení vaší účasti odpovědí na tento e-mail.</p>
      <p>S pozdravem,<br>Nadace Inge a Miloše Pavelcových</p>
    `,
  });
}

async function sendPasswordResetEmail(email, firstName, token) {
  const url = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  await sendEmail({
    to: email,
    subject: 'Obnovení hesla - Nadace Pavelcových',
    html: `
      <p>Dobrý den${firstName ? ', ' + firstName : ''},</p>
      <p>obdrželi jsme žádost o obnovení hesla k vašemu účtu.</p>
      <p>Pro nastavení nového hesla klikněte na tento odkaz:</p>
      <p><a href="${url}">${url}</a></p>
      <p>Odkaz je platný 1 hodinu. Pokud jste o obnovení hesla nežádali, tento e-mail ignorujte.</p>
      <p>S pozdravem,<br>Nadace Inge a Miloše Pavelcových</p>
    `,
  });
}

module.exports = { sendEmail, sendVerificationEmail, sendStatusChangeEmail, sendInterviewInviteEmail, sendPasswordResetEmail };
