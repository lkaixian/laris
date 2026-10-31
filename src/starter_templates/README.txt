LARIS starter templates
=======================

Six Word templates, one for each document LARIS generates:

  purchase_order-template.docx   Purchase order
  sales_order-template.docx      Sales order
  proforma-template.docx         Proforma invoice
  delivery_order-template.docx   Delivery order (no prices, with a sign-off for the receiver)
  invoice-template.docx          Invoice
  receipt-template.docx          Receipt

Upload each one in LARIS under Admin > Document templates, for its document type.
LARIS replaces every {{placeholder}} with the order's details when the document is generated.

sample-preview.pdf shows all six filled with example data.


Adding your company logo
------------------------
Top left of every template there is a blank logo space (it prints nothing until you fill it).
1. Open the template in Word.
2. Click just above your company name: a small empty box is selected.
3. Right-click it > Change Picture > choose your logo file.
4. Save as .docx and upload it to LARIS.
Do this once per template. A wide logo (about 3:1) fits the space best.


Editing tips
------------
- Keep each {{placeholder}} in one style. LARIS gives the whole line the style of its first word.
- The title shows as {{DOC_TYPE}} in capitals. That is only the capitals formatting. If you retype it, type {{doc_type}}.
- The item table row with {{line.no}}, {{line.description}} and so on repeats once per item. Keep it as one table row.
- If a field has no value, its label stays with nothing after it (for example "Attn:" with no name).
- Save as a plain .docx (not .docm), under 2 MB, without embedded objects.


Placeholders
------------
{{doc_no}}               Document number
{{doc_type}}             Document title, e.g. Invoice
{{date}}                 Date issued (dd/mm/yyyy)
{{due_date}}             Payment due date (invoice)
{{reference}}            The customer's own PO number, when there is one
{{status}}               Document status
{{customer_name}}        Customer name
{{customer_attention}}   Customer contact person
{{customer_address}}     Customer address
{{customer_email}}       Customer email
{{company_name}}         Your business name
{{company_address}}      Your address
{{company_ssm}}          Your SSM number
{{company_sst}}          Your SST number
{{company_email}}        Your email
{{company_phone}}        Your phone
{{bank_details}}         Your bank details
{{currency}}             Currency, e.g. RM
{{subtotal}}             Total before tax
{{tax}}                  SST amount
{{total}}                Total to pay
{{payment_terms}}        Payment terms
{{terms}}                Terms and conditions
{{deposit_percent}}      Deposit % (proforma)
{{deposit_amount}}       Deposit amount (proforma)
{{deposit_paid}}         Deposit already paid (invoice)
{{balance_due}}          Balance still to pay
{{amount_paid}}          Amount received (receipt)
{{payment_method}}       How it was paid (receipt)
{{payment_reference}}    Payment reference (receipt)
{{signed_by}}            Name of the person who signed for the goods (delivery order)
{{signed_at}}            When they signed (delivery order)
{{line.no}}              Each item: no
{{line.description}}     Each item: description
{{line.qty}}             Each item: qty
{{line.uom}}             Each item: uom
{{line.unit_price}}      Each item: unit price
{{line.amount}}          Each item: amount

The brand font (Ubuntu, Ubuntu Font Licence) is built into each file so it looks the same on any computer.
