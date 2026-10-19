// The first audio callback must not subtract a lazily initialized clock value
// that was sampled after its own timestamp. UInt64 subtraction would trap.
struct AudioLevelThrottle {
  private var previous: UInt64?

  mutating func shouldEmit(at now: UInt64) -> Bool {
    if let previous, now >= previous, now - previous < 50_000_000 { return false }
    previous = now
    return true
  }
}
