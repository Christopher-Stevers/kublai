import nodemailer from "nodemailer";
import { ADMIN_EMAIL } from "~/constants/app";

/**
 * Create a nodemailer transporter
 * For production, configure SMTP settings via environment variables
 * For development, you can use Gmail with an app password or a service like Mailtrap
 */
function createTransporter() {
  // Check if SMTP is configured via environment variables
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT
    ? Number.parseInt(process.env.SMTP_PORT, 10)
    : undefined;
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;

  if (smtpHost && smtpUser && smtpPassword) {
    // Use configured SMTP
    return nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort ?? 587,
      secure: smtpPort === 465, // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPassword,
      },
    });
  }

  // For development: use a test account (doesn't actually send emails)
  // In production, you MUST configure SMTP settings
  if (process.env.NODE_ENV === "development") {
    console.warn(
      "⚠️  No SMTP configured. Using test account (emails won't be sent). Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD environment variables.",
    );
    return nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: "test@ethereal.email",
        pass: "test",
      },
    });
  }

  // In production without SMTP, throw an error
  throw new Error(
    "SMTP configuration required in production. Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD environment variables.",
  );
}

/**
 * Send an email notification
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<void> {
  try {
    const transporter = createTransporter();
    const from = process.env.SMTP_FROM ?? ADMIN_EMAIL;

    const info = await transporter.sendMail({
      from: `"${process.env.APP_NAME ?? "Genghis"}" <${from}>`,
      to,
      subject,
      text: text ?? html.replace(/<[^>]*>/g, ""), // Strip HTML for text version
      html,
    });

    if (process.env.NODE_ENV === "development") {
      console.log("📧 Email sent (test mode):", nodemailer.getTestMessageUrl(info));
    } else {
      console.log("📧 Email sent to:", to);
    }
  } catch (error) {
    console.error("Failed to send email:", error);
    // Don't throw - email failure shouldn't break the order approval
    // But log it for monitoring
  }
}

/**
 * Send order approval notification email
 */
export async function sendOrderApprovalEmail({
  orderId,
  userEmail,
  userName,
  totalPrice,
  currency = "cad",
}: {
  orderId: string;
  userEmail: string;
  userName: string | null;
  totalPrice: number;
  currency?: string;
}): Promise<void> {
  const formattedPrice = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(totalPrice / 100); // Convert cents to dollars

  const subject = `Order Approved - ${orderId.slice(0, 8)}`;
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #1f2937; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background-color: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
          .order-details { background-color: white; padding: 15px; border-radius: 4px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Order Approved</h1>
          </div>
          <div class="content">
            <p>Hello ${userName ?? "there"},</p>
            <p>Your order has been approved and payment has been processed successfully.</p>
            <div class="order-details">
              <h3>Order Details</h3>
              <p><strong>Order ID:</strong> ${orderId}</p>
              <p><strong>Total Amount:</strong> ${formattedPrice}</p>
              <p><strong>Status:</strong> Approved & Paid</p>
            </div>
            <p>Your campaign is now active. If you have any questions, please contact us.</p>
            <div class="footer">
              <p>This is an automated message from Genghis</p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;

  // Send to admin email (as requested)
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `[Admin] ${subject}`,
    html: `
      <h2>Order Approved Notification</h2>
      <p>An order has been approved:</p>
      <ul>
        <li><strong>Order ID:</strong> ${orderId}</li>
        <li><strong>Customer:</strong> ${userName ?? "Unknown"} (${userEmail})</li>
        <li><strong>Total Amount:</strong> ${formattedPrice}</li>
        <li><strong>Status:</strong> Approved & Paid</li>
      </ul>
    `,
  });

  // Also send confirmation to customer
  await sendEmail({
    to: userEmail,
    subject,
    html,
  });
}

