use std::collections::VecDeque;

/// Bounded event buffer with monotonic sequence numbers. Oldest entries are
/// dropped at capacity; sequence numbers keep increasing so attached clients
/// can dedupe replayed events against a live tail.
pub struct RingBuffer<T> {
    items: VecDeque<(u64, T)>,
    next_seq: u64,
    cap: usize,
}

impl<T> RingBuffer<T> {
    pub fn new(cap: usize) -> Self {
        Self {
            items: VecDeque::with_capacity(cap.min(64)),
            next_seq: 0,
            cap,
        }
    }

    pub fn push(&mut self, item: T) -> u64 {
        let seq = self.next_seq;
        self.next_seq += 1;
        if self.items.len() == self.cap {
            self.items.pop_front();
        }
        self.items.push_back((seq, item));
        seq
    }

    pub fn iter(&self) -> impl Iterator<Item = &(u64, T)> {
        self.items.iter()
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.items.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seq_is_monotonic_and_returned() {
        let mut buf = RingBuffer::new(4);
        for i in 0..4u64 {
            assert_eq!(buf.push(i), i);
        }
        let seqs: Vec<u64> = buf.iter().map(|(seq, _)| *seq).collect();
        assert_eq!(seqs, vec![0, 1, 2, 3]);
    }

    #[test]
    fn wraparound_drops_oldest_keeps_seq() {
        let mut buf = RingBuffer::new(3);
        for i in 0..5u64 {
            buf.push(i * 10);
        }
        assert_eq!(buf.len(), 3);
        let entries: Vec<(u64, u64)> = buf.iter().cloned().collect();
        assert_eq!(entries, vec![(2, 20), (3, 30), (4, 40)]);
        // Next push continues the sequence.
        assert_eq!(buf.push(50), 5);
    }
}
