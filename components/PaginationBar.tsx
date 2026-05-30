import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

interface Props {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
  totalResults?: number;
}

function buildPages(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const result: (number | '…')[] = [1];
  const lo = Math.max(2, current - 1);
  const hi = Math.min(total - 1, current + 1);
  if (lo > 2) result.push('…');
  for (let i = lo; i <= hi; i++) result.push(i);
  if (hi < total - 1) result.push('…');
  result.push(total);
  return result;
}

export default function PaginationBar({
  currentPage,
  totalPages,
  onPageChange,
  loading = false,
  totalResults,
}: Props) {
  const [showGoTo, setShowGoTo] = useState(false);
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState('');

  if (totalPages <= 1) return null;

  const pages = buildPages(currentPage, totalPages);

  const submit = () => {
    const p = parseInt(input, 10);
    if (Number.isFinite(p) && p >= 1 && p <= totalPages) {
      onPageChange(p);
      setShowGoTo(false);
      setInput('');
      setInputError('');
      return;
    }
    setInputError(`Введи число от 1 до ${totalPages}`);
  };

  const closeGoTo = () => {
    setShowGoTo(false);
    setInput('');
    setInputError('');
  };

  return (
    <View style={s.wrap}>
      {totalResults !== undefined && totalResults > 0 && (
        <Text style={s.info}>
          {totalResults.toLocaleString('ru-RU')} результатов · стр. {currentPage} из {totalPages}
        </Text>
      )}

      <View style={s.bar}>
        <TouchableOpacity
          style={[s.btn, (loading || currentPage === 1) && s.btnDisabled]}
          disabled={loading || currentPage === 1}
          onPress={() => onPageChange(currentPage - 1)}
        >
          <Ionicons name="chevron-back" size={18} color={currentPage === 1 ? '#444' : '#ccc'} />
        </TouchableOpacity>

        {pages.map((p, i) =>
          p === '…' ? (
            <TouchableOpacity
              key={`d${i}`}
              onPress={() => { setInput(''); setShowGoTo(true); }}
              disabled={loading}
            >
              <Text style={s.dots}>···</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              key={p}
              style={[s.btn, currentPage === p && s.btnActive, loading && s.btnDisabled]}
              disabled={loading}
              onPress={() => onPageChange(p as number)}
            >
              <Text style={[s.num, currentPage === p && s.numActive]}>{p}</Text>
            </TouchableOpacity>
          )
        )}

        <TouchableOpacity
          style={[s.btn, (loading || currentPage === totalPages) && s.btnDisabled]}
          disabled={loading || currentPage === totalPages}
          onPress={() => onPageChange(currentPage + 1)}
        >
          <Ionicons name="chevron-forward" size={18} color={currentPage === totalPages ? '#444' : '#ccc'} />
        </TouchableOpacity>
      </View>

      <Modal visible={showGoTo} transparent animationType="fade" onRequestClose={closeGoTo}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={closeGoTo}>
          <TouchableOpacity activeOpacity={1} style={s.dialog}>
            <Text style={s.dialogTitle}>Перейти к странице</Text>
            <TextInput
              style={s.dialogInput}
              keyboardType="number-pad"
              placeholder={`1 – ${totalPages}`}
              placeholderTextColor="#777"
              value={input}
              onChangeText={v => { setInput(v); if (inputError) setInputError(''); }}
              autoFocus
              onSubmitEditing={submit}
            />
            {inputError ? <Text style={s.dialogError}>{inputError}</Text> : null}
            <TouchableOpacity style={s.dialogBtn} onPress={submit}>
              <Text style={s.dialogBtnText}>Перейти</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 20, paddingBottom: 28 },
  info: { color: '#666', fontSize: 12, marginBottom: 12 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btn: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1e1e30',
  },
  btnActive: { backgroundColor: '#e50914' },
  btnDisabled: { opacity: 0.35 },
  num: { color: '#aaa', fontSize: 13, fontWeight: '600' },
  numActive: { color: '#fff' },
  dots: { color: '#555', fontSize: 16, paddingHorizontal: 4, lineHeight: 36 },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center', justifyContent: 'center',
  },
  dialog: {
    backgroundColor: '#1a1a2e', borderRadius: 20, padding: 24,
    width: 260, alignItems: 'center', gap: 14,
  },
  dialogTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  dialogInput: {
    backgroundColor: '#0f0f1a', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    color: '#fff', fontSize: 16, width: '100%', textAlign: 'center',
  },
  dialogBtn: { backgroundColor: '#e50914', borderRadius: 12, paddingHorizontal: 32, paddingVertical: 12 },
  dialogBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  dialogError: { color: '#e50914', fontSize: 12, textAlign: 'center', marginTop: -8 },
});
