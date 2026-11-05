export function PrintStyle() {
  return <style>{`@media print { body * { visibility: hidden; } .crm-print, .crm-print * { visibility: visible; } .crm-print { position: absolute; left: 0; top: 0; width: 100%; color: black; background: white; } .crm-print .btn { display: none; } .crm-print tr, .crm-print figure { break-inside: avoid; } } .crm-print img { max-width: 320px; max-height: 220px; object-fit: contain; }`}</style>;
}
