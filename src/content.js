/**
 * content.js – Page2Email content script.
 *
 * Injected on demand by popup.js when PDF capture is requested.
 * Expects html2pdf.bundle.min.js to be already loaded in the page.
 */

(async () => {
  try {
    const opt = {
      margin:       0.3,
      filename:     'page.pdf',
      image:        { type: 'jpeg', quality: 0.95 },
      html2canvas:  { scale: 2, useCORS: true, scrollY: 0 },
      jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' },
    };

    // Generate the PDF as a base-64 data URL
    const pdfDataUrl = await html2pdf()
      .set(opt)
      .from(document.body)
      .outputPdf('dataurlstring');

    // Return the data URL to the caller (popup.js) via the injected script result
    return pdfDataUrl;
  } catch (err) {
    throw new Error('PDF generation failed: ' + err.message);
  }
})();
