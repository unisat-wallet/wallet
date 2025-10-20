function isNull(val: any) {
  if (typeof val == 'undefined' || val == null || val == 'undefined') {
    return true
  } else {
    return false
  }
}

export const typeUtils = {
  isNull,
}
