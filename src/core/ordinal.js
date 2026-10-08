// English ordinals for places: 1 -> '1st', 2 -> '2nd', 3 -> '3rd', 4 -> '4th'; 11-13 take 'th' (the standard
// exception) and everything else keys off the last digit. Pure and format-agnostic: any format's results, report
// or venue display words a place with it.
export function ordinalLabel(n) {
  const remainder100 = n % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
