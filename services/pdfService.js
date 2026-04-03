const PDFDocument = require('pdfkit');
const logger = require('../utils/logger');
const log = logger.child('PDFService');

/**
 * Generates a professional PDF invoice buffer from invoice data.
 * Returns a Promise that resolves to a Buffer.
 */
exports.generateInvoicePDF = (invoice, garage) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const pageWidth = doc.page.width - 100; // minus margins

      // ===== HEADER =====
      doc.fontSize(22).font('Helvetica-Bold')
        .fillColor('#1e293b')
        .text(garage?.name || 'GarageFlow', 50, 50);

      doc.fontSize(9).font('Helvetica').fillColor('#64748b');
      let headerY = 75;
      if (garage?.address?.street) {
        doc.text(`${garage.address.street}`, 50, headerY);
        headerY += 13;
      }
      const cityState = [garage?.address?.city, garage?.address?.state, garage?.address?.pincode].filter(Boolean).join(', ');
      if (cityState) {
        doc.text(cityState, 50, headerY);
        headerY += 13;
      }
      if (garage?.phone) {
        doc.text(`Phone: ${garage.phone}`, 50, headerY);
        headerY += 13;
      }
      if (garage?.email) {
        doc.text(`Email: ${garage.email}`, 50, headerY);
        headerY += 13;
      }
      if (garage?.gstNumber) {
        doc.text(`GSTIN: ${garage.gstNumber}`, 50, headerY);
        headerY += 13;
      }

      // Invoice title on the right
      doc.fontSize(28).font('Helvetica-Bold').fillColor('#3b5ff8')
        .text('INVOICE', 350, 50, { align: 'right', width: pageWidth - 300 });

      doc.fontSize(10).font('Helvetica').fillColor('#334155')
        .text(`Invoice #: ${invoice.invoiceNumber || 'N/A'}`, 350, 85, { align: 'right', width: pageWidth - 300 })
        .text(`Date: ${new Date(invoice.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`, 350, 100, { align: 'right', width: pageWidth - 300 });

      if (invoice.paidAt) {
        doc.fillColor('#059669')
          .text(`Paid: ${new Date(invoice.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`, 350, 115, { align: 'right', width: pageWidth - 300 });
      }

      // Horizontal line
      const lineY = Math.max(headerY, 135) + 10;
      doc.moveTo(50, lineY).lineTo(50 + pageWidth, lineY).strokeColor('#e2e8f0').lineWidth(1).stroke();

      // ===== CUSTOMER & VEHICLE INFO =====
      let infoY = lineY + 15;

      // Bill To
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#94a3b8').text('BILL TO', 50, infoY);
      infoY += 15;
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#1e293b')
        .text(invoice.customer?.name || 'Customer', 50, infoY);
      infoY += 16;
      doc.fontSize(9).font('Helvetica').fillColor('#475569');
      if (invoice.customer?.phone) {
        doc.text(`Phone: ${invoice.customer.phone}`, 50, infoY);
        infoY += 13;
      }
      if (invoice.customer?.email) {
        doc.text(`Email: ${invoice.customer.email}`, 50, infoY);
        infoY += 13;
      }

      // Vehicle info on the right
      let vehicleY = lineY + 15;
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#94a3b8').text('VEHICLE', 350, vehicleY);
      vehicleY += 15;
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#1e293b')
        .text(invoice.vehicle?.licensePlate || 'N/A', 350, vehicleY);
      vehicleY += 16;
      doc.fontSize(9).font('Helvetica').fillColor('#475569')
        .text(`${invoice.vehicle?.make || ''} ${invoice.vehicle?.model || ''} ${invoice.vehicle?.year ? `(${invoice.vehicle.year})` : ''}`.trim(), 350, vehicleY);
      vehicleY += 13;
      if (invoice.vehicle?.color) {
        doc.text(`Color: ${invoice.vehicle.color}`, 350, vehicleY);
        vehicleY += 13;
      }

      // ===== PARTS TABLE =====
      let tableY = Math.max(infoY, vehicleY) + 20;

      if (invoice.parts?.length > 0) {
        // Table heading
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b').text('Parts', 50, tableY);
        tableY += 18;

        // Table header row
        doc.rect(50, tableY, pageWidth, 22).fill('#f1f5f9');
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#475569');
        doc.text('#', 58, tableY + 6, { width: 25 });
        doc.text('Part Name', 85, tableY + 6, { width: 200 });
        doc.text('Qty', 310, tableY + 6, { width: 50, align: 'center' });
        doc.text('Unit Price', 370, tableY + 6, { width: 80, align: 'right' });
        doc.text('Total', 460, tableY + 6, { width: 80, align: 'right' });
        tableY += 22;

        // Parts rows
        invoice.parts.forEach((part, i) => {
          if (tableY > 700) {
            doc.addPage();
            tableY = 50;
          }
          doc.fontSize(9).font('Helvetica').fillColor('#334155');
          doc.text(`${i + 1}`, 58, tableY + 5, { width: 25 });
          doc.text(part.partName || 'Unnamed Part', 85, tableY + 5, { width: 200 });
          doc.text(`${part.quantity}`, 310, tableY + 5, { width: 50, align: 'center' });
          doc.text(`${formatCurrency(part.unitPrice)}`, 370, tableY + 5, { width: 80, align: 'right' });
          doc.font('Helvetica-Bold').text(`${formatCurrency(part.total || part.quantity * part.unitPrice)}`, 460, tableY + 5, { width: 80, align: 'right' });

          // Row border
          tableY += 22;
          doc.moveTo(50, tableY).lineTo(50 + pageWidth, tableY).strokeColor('#f1f5f9').lineWidth(0.5).stroke();
        });

        tableY += 8;
      }

      // ===== LABOR TABLE =====
      if (invoice.labor?.length > 0) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b').text('Labor', 50, tableY);
        tableY += 18;

        doc.rect(50, tableY, pageWidth, 22).fill('#f1f5f9');
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#475569');
        doc.text('#', 58, tableY + 6, { width: 25 });
        doc.text('Description', 85, tableY + 6, { width: 200 });
        doc.text('Hours', 310, tableY + 6, { width: 50, align: 'center' });
        doc.text('Rate/Hr', 370, tableY + 6, { width: 80, align: 'right' });
        doc.text('Total', 460, tableY + 6, { width: 80, align: 'right' });
        tableY += 22;

        invoice.labor.forEach((labor, i) => {
          if (tableY > 700) {
            doc.addPage();
            tableY = 50;
          }
          doc.fontSize(9).font('Helvetica').fillColor('#334155');
          doc.text(`${i + 1}`, 58, tableY + 5, { width: 25 });
          doc.text(labor.description || 'Labor', 85, tableY + 5, { width: 200 });
          doc.text(`${labor.hours}`, 310, tableY + 5, { width: 50, align: 'center' });
          doc.text(`${formatCurrency(labor.ratePerHour)}`, 370, tableY + 5, { width: 80, align: 'right' });
          doc.font('Helvetica-Bold').text(`${formatCurrency(labor.total || labor.hours * labor.ratePerHour)}`, 460, tableY + 5, { width: 80, align: 'right' });
          tableY += 22;
          doc.moveTo(50, tableY).lineTo(50 + pageWidth, tableY).strokeColor('#f1f5f9').lineWidth(0.5).stroke();
        });

        tableY += 8;
      }

      // ===== TOTALS BOX =====
      if (tableY > 650) {
        doc.addPage();
        tableY = 50;
      }

      const totalsX = 350;
      const totalsWidth = pageWidth - 300;
      tableY += 10;

      // Subtotal
      doc.fontSize(9).font('Helvetica').fillColor('#475569');
      doc.text('Subtotal', totalsX, tableY, { width: totalsWidth - 90 });
      doc.text(formatCurrency(invoice.subtotal), totalsX + totalsWidth - 90, tableY, { width: 90, align: 'right' });
      tableY += 18;

      // Discount
      if (invoice.discount > 0) {
        doc.fillColor('#059669');
        doc.text('Discount', totalsX, tableY, { width: totalsWidth - 90 });
        doc.text(`-${formatCurrency(invoice.discount)}`, totalsX + totalsWidth - 90, tableY, { width: 90, align: 'right' });
        tableY += 18;
      }

      // Tax
      doc.fillColor('#475569');
      doc.text(`Tax (${invoice.taxRate || 18}%)`, totalsX, tableY, { width: totalsWidth - 90 });
      doc.text(formatCurrency(invoice.taxAmount), totalsX + totalsWidth - 90, tableY, { width: 90, align: 'right' });
      tableY += 20;

      // Grand Total
      doc.moveTo(totalsX, tableY).lineTo(totalsX + totalsWidth, tableY).strokeColor('#1e293b').lineWidth(1).stroke();
      tableY += 8;
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#1e293b');
      doc.text('Grand Total', totalsX, tableY, { width: totalsWidth - 90 });
      doc.text(formatCurrency(invoice.grandTotal), totalsX + totalsWidth - 90, tableY, { width: 90, align: 'right' });
      tableY += 25;

      // Payment Status Badge
      const statusColors = {
        paid: { bg: '#d1fae5', text: '#047857', label: 'PAID' },
        partial: { bg: '#fef3c7', text: '#d97706', label: 'PARTIALLY PAID' },
        unpaid: { bg: '#fee2e2', text: '#dc2626', label: 'UNPAID' }
      };
      const statusStyle = statusColors[invoice.paymentStatus] || statusColors.unpaid;
      doc.roundedRect(totalsX + totalsWidth - 100, tableY, 100, 22, 4).fill(statusStyle.bg);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(statusStyle.text)
        .text(statusStyle.label, totalsX + totalsWidth - 100, tableY + 6, { width: 100, align: 'center' });

      // ===== FOOTER =====
      const footerY = doc.page.height - 90;
      doc.moveTo(50, footerY).lineTo(50 + pageWidth, footerY).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
        .text('Thank you for your business!', 50, footerY + 10, { align: 'center', width: pageWidth })
        .text(`Generated by GarageFlow CRM | ${new Date().toLocaleDateString('en-IN')}`, 50, footerY + 20, { align: 'center', width: pageWidth });

      doc.end();

      log.info('Invoice PDF generated', { invoiceNumber: invoice.invoiceNumber });
    } catch (err) {
      log.error('PDF generation failed', { error: err.message });
      reject(err);
    }
  });
};

function formatCurrency(amount) {
  if (!amount && amount !== 0) return '0.00';
  return `Rs. ${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
