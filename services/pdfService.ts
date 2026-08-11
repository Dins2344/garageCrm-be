import PDFDocument from 'pdfkit';
import logger from '../utils/logger';
const log = logger.child('PDFService');

interface PDFPart {
  partName?: string;
  quantity?: number;
  unitPrice?: number;
  total?: number;
}

interface PDFLabor {
  description?: string;
  hours?: number;
  ratePerHour?: number;
  total?: number;
}

interface PDFCustomer {
  name?: string;
  phone?: string;
  email?: string;
}

interface PDFVehicle {
  licensePlate?: string;
  make?: string;
  model?: string;
  year?: number;
  color?: string;
}

interface PDFGarageAddress {
  street?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

interface PDFGarage {
  name?: string;
  address?: PDFGarageAddress;
  phone?: string;
  gstNumber?: string;
}

interface PDFData {
  invoiceNumber?: string;
  createdAt?: Date | string;
  paidAt?: Date | string | null;
  customer?: PDFCustomer;
  vehicle?: PDFVehicle;
  parts?: PDFPart[];
  labor?: PDFLabor[];
  discount?: number;
  taxRate?: number;
  taxAmount?: number;
  grandTotal?: number;
  paymentStatus?: string;
  isEstimation?: boolean;
}

interface PDFJobCard {
  jobCardNumber: string;
  customer?: PDFCustomer;
  vehicle?: PDFVehicle;
  createdAt: Date | string;
  estimation: PDFData;
}

/**
 * Generates a professional PDF invoice buffer from invoice data.
 */
export const generateInvoicePDF = (invoice: PDFData, garage: PDFGarage | null): Promise<Buffer> => {
  return generatePDF(invoice, garage, 'INVOICE');
};

/**
 * Generates a professional PDF estimation buffer from job card data.
 */
export const generateEstimationPDF = (jobCard: PDFJobCard, garage: PDFGarage | null): Promise<Buffer> => {
  // Map jobCard estimation structure to match invoice structure for the helper
  const data: PDFData = {
    ...jobCard.estimation,
    invoiceNumber: jobCard.jobCardNumber, // Use JC number as reference
    customer: jobCard.customer,
    vehicle: jobCard.vehicle,
    createdAt: jobCard.createdAt,
    isEstimation: true
  };
  return generatePDF(data, garage, 'ESTIMATION');
};

/**
 * Shared helper to generate PDF for both invoices and estimations
 */
const generatePDF = (data: PDFData, garage: PDFGarage | null, title: 'INVOICE' | 'ESTIMATION'): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const buffers: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const pageWidth = doc.page.width - 100;

      // ===== HEADER =====
      doc.fontSize(22).font('Helvetica-Bold').fillColor('#1e293b').text(garage?.name || 'GaragePulse', 50, 50);

      doc.fontSize(9).font('Helvetica').fillColor('#64748b');
      let headerY = 75;
      if (garage?.address?.street) { doc.text(`${garage.address.street}`, 50, headerY); headerY += 13; }
      const cityState = [garage?.address?.city, garage?.address?.state, garage?.address?.pincode].filter(Boolean).join(', ');
      if (cityState) { doc.text(cityState, 50, headerY); headerY += 13; }
      if (garage?.phone) { doc.text(`Phone: ${garage.phone}`, 50, headerY); headerY += 13; }
      if (garage?.gstNumber) { doc.text(`GSTIN: ${garage.gstNumber}`, 50, headerY); headerY += 13; }

      // Title on the right
      doc.fontSize(28).font('Helvetica-Bold').fillColor(title === 'INVOICE' ? '#3b5ff8' : '#64748b')
        .text(title, 350, 50, { align: 'right', width: pageWidth - 300 });

      doc.fontSize(10).font('Helvetica').fillColor('#334155')
        .text(`${title} #: ${data.invoiceNumber || 'N/A'}`, 350, 85, { align: 'right', width: pageWidth - 300 })
        .text(`Date: ${new Date(data.createdAt as string).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`, 350, 100, { align: 'right', width: pageWidth - 300 });

      if (data.paidAt) {
        doc.fillColor('#059669').text(`Paid: ${new Date(data.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`, 350, 115, { align: 'right', width: pageWidth - 300 });
      }

      const lineY = Math.max(headerY, 135) + 10;
      doc.moveTo(50, lineY).lineTo(50 + pageWidth, lineY).strokeColor('#e2e8f0').lineWidth(1).stroke();

      // ===== CUSTOMER & VEHICLE INFO =====
      let infoY = lineY + 15;
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#94a3b8').text('BILL TO', 50, infoY);
      infoY += 15;
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#1e293b').text(data.customer?.name || 'Customer', 50, infoY);
      infoY += 16;
      doc.fontSize(9).font('Helvetica').fillColor('#475569');
      if (data.customer?.phone) { doc.text(`Phone: ${data.customer.phone}`, 50, infoY); infoY += 13; }
      if (data.customer?.email) { doc.text(`Email: ${data.customer.email}`, 50, infoY); infoY += 13; }

      let vehicleY = lineY + 15;
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#94a3b8').text('VEHICLE', 350, vehicleY);
      vehicleY += 15;
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#1e293b').text(data.vehicle?.licensePlate || 'N/A', 350, vehicleY);
      vehicleY += 16;
      doc.fontSize(9).font('Helvetica').fillColor('#475569').text(`${data.vehicle?.make || ''} ${data.vehicle?.model || ''} ${data.vehicle?.year ? `(${data.vehicle.year})` : ''}`.trim(), 350, vehicleY);
      vehicleY += 13;
      if (data.vehicle?.color) { doc.text(`Color: ${data.vehicle.color}`, 350, vehicleY); vehicleY += 13; }

      // ===== TABLES (Parts & Labor) =====
      let tableY = Math.max(infoY, vehicleY) + 20;

      // Parts Table
      if (data.parts && data.parts.length > 0) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b').text('Parts', 50, tableY);
        tableY += 18;
        doc.rect(50, tableY, pageWidth, 22).fill('#f1f5f9');
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#475569');
        doc.text('#', 58, tableY + 6, { width: 25 });
        doc.text('Part Name', 85, tableY + 6, { width: 200 });
        doc.text('Qty', 310, tableY + 6, { width: 50, align: 'center' });
        doc.text('Unit Price', 370, tableY + 6, { width: 80, align: 'right' });
        doc.text('Total', 460, tableY + 6, { width: 80, align: 'right' });
        tableY += 22;

        data.parts.forEach((p, i) => {
          if (tableY > 700) { doc.addPage(); tableY = 50; }
          doc.fontSize(9).font('Helvetica').fillColor('#334155');
          doc.text(`${i + 1}`, 58, tableY + 5, { width: 25 });
          doc.text(p.partName || 'Part', 85, tableY + 5, { width: 200 });
          doc.text(`${p.quantity}`, 310, tableY + 5, { width: 50, align: 'center' });
          doc.text(formatCurrency(p.unitPrice), 370, tableY + 5, { width: 80, align: 'right' });
          doc.font('Helvetica-Bold').text(formatCurrency(p.total), 460, tableY + 5, { width: 80, align: 'right' });
          tableY += 22;
          doc.moveTo(50, tableY).lineTo(50 + pageWidth, tableY).strokeColor('#f1f5f9').lineWidth(0.5).stroke();
        });
        tableY += 8;
      }

      // Labor Table
      if (data.labor && data.labor.length > 0) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b').text('Labor / Service', 50, tableY);
        tableY += 18;
        doc.rect(50, tableY, pageWidth, 22).fill('#f1f5f9');
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#475569');
        doc.text('#', 58, tableY + 6, { width: 25 });
        doc.text('Description', 85, tableY + 6, { width: 200 });
        doc.text('Hours', 310, tableY + 6, { width: 50, align: 'center' });
        doc.text('Rate/Hr', 370, tableY + 6, { width: 80, align: 'right' });
        doc.text('Total', 460, tableY + 6, { width: 80, align: 'right' });
        tableY += 22;

        data.labor.forEach((l, i) => {
          if (tableY > 700) { doc.addPage(); tableY = 50; }
          doc.fontSize(9).font('Helvetica').fillColor('#334155');
          doc.text(`${i + 1}`, 58, tableY + 5, { width: 25 });
          doc.text(l.description || 'Labor', 85, tableY + 5, { width: 200 });
          doc.text(`${l.hours}`, 310, tableY + 5, { width: 50, align: 'center' });
          doc.text(formatCurrency(l.ratePerHour), 370, tableY + 5, { width: 80, align: 'right' });
          doc.font('Helvetica-Bold').text(formatCurrency(l.total), 460, tableY + 5, { width: 80, align: 'right' });
          tableY += 22;
          doc.moveTo(50, tableY).lineTo(50 + pageWidth, tableY).strokeColor('#f1f5f9').lineWidth(0.5).stroke();
        });
        tableY += 8;
      }

      // ===== TOTALS BOX WITH BREAKDOWN =====
      if (tableY > 600) { doc.addPage(); tableY = 50; }

      const totalsX = 350;
      const totalsWidth = pageWidth - 300;
      tableY += 10;

      // Calculate totals
      const partsTotal = data.parts?.reduce((s, p) => s + (p.total || 0), 0) || 0;
      const laborTotal = data.labor?.reduce((s, l) => s + (l.total || 0), 0) || 0;

      doc.fontSize(9).font('Helvetica').fillColor('#475569');

      doc.text('Total Spare Parts', totalsX, tableY, { width: totalsWidth - 90 });
      doc.text(formatCurrency(partsTotal), totalsX + totalsWidth - 90, tableY, { width: 90, align: 'right' });
      tableY += 15;

      doc.text('Total Labor Charges', totalsX, tableY, { width: totalsWidth - 90 });
      doc.text(formatCurrency(laborTotal), totalsX + totalsWidth - 90, tableY, { width: 90, align: 'right' });
      tableY += 15;

      if (data.discount && data.discount > 0) {
        doc.fillColor('#059669');
        doc.text('Special Discount', totalsX, tableY, { width: totalsWidth - 90 });
        doc.text(`-${formatCurrency(data.discount)}`, totalsX + totalsWidth - 90, tableY, { width: 90, align: 'right' });
        tableY += 15;
      }

      doc.fillColor('#475569');
      doc.text(`Tax (${data.taxRate || 18}%)`, totalsX, tableY, { width: totalsWidth - 90 });
      doc.text(formatCurrency(data.taxAmount), totalsX + totalsWidth - 90, tableY, { width: 90, align: 'right' });
      tableY += 20;

      doc.moveTo(totalsX, tableY).lineTo(totalsX + totalsWidth, tableY).strokeColor('#1e293b').lineWidth(1).stroke();
      tableY += 8;
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#1e293b');
      doc.text('Total Amount', totalsX, tableY, { width: totalsWidth - 90 });
      doc.text(formatCurrency(data.grandTotal), totalsX + totalsWidth - 90, tableY, { width: 90, align: 'right' });
      tableY += 25;

      // ===== FOOTER =====
      const footerY = doc.page.height - 90;
      doc.moveTo(50, footerY).lineTo(50 + pageWidth, footerY).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
        .text(title === 'INVOICE' ? 'Thank you for your business!' : 'This is a computer generated estimation and not an invoice.', 50, footerY + 10, { align: 'center', width: pageWidth })
        .text(`Generated by GaragePulse CRM | ${new Date().toLocaleDateString('en-IN')}`, 50, footerY + 20, { align: 'center', width: pageWidth });

      doc.end();
      log.info(`${title} PDF generated`);
    } catch (err) {
      log.error('PDF generation failed', { error: (err as Error).message });
      reject(err);
    }
  });
};

function formatCurrency(amount?: number): string {
  if (!amount && amount !== 0) return '0.00';
  return `Rs. ${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
