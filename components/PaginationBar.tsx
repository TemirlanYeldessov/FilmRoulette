import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors, radii } from '../constants/theme';

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
          <Ionicons name="chevron-back" size={18} color={currentPage === 1 ? colors.faint : colors.textSoft} />
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
          <Ionicons name="chevron-forward" size={18} color={currentPage === totalPages ? colors.faint : colors.textSoft} />
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
              placeholderTextColor={colors.muted2}
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
  info: { color: colors.muted2, fontSize: 12, marginBottom: 12 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btn: {
    width: 36, height: 36, borderRadius: radii.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  btnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  btnDisabled: { opacity: 0.35 },
  num: { color: colors.textSoft, fontSize: 13, fontWeight: '700' },
  numActive: { color: colors.text },
  dots: { color: colors.muted2, fontSize: 16, paddingHorizontal: 4, lineHeight: 36 },
  overlay: {
    flex: 1, backgroundColor: colors.overlay,
    alignItems: 'center', justifyContent: 'center',
  },
  dialog: {
    backgroundColor: colors.surfaceElevated, borderRadius: radii.xl, padding: 24,
    width: 260, alignItems: 'center', gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dialogTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  dialogInput: {
    backgroundColor: colors.bgSoft, borderRadius: radii.md,
    paddingHorizontal: 16, paddingVertical: 12,
    color: colors.text, fontSize: 16, width: '100%', textAlign: 'center',
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  dialogBtn: { backgroundColor: colors.primary, borderRadius: radii.md, paddingHorizontal: 32, paddingVertical: 12 },
  dialogBtnText: { color: colors.text, fontWeight: '800', fontSize: 15 },
  dialogError: { color: colors.primary, fontSize: 12, textAlign: 'center', marginTop: -8 },
});
