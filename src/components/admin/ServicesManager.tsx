import React, { useState } from 'react';
import { AlertTriangle, Clock, EyeOff, FolderPlus, Loader2, Pencil, Plus, Tag, Trash2, Users } from 'lucide-react';
import { Professional, Service, ServiceCategory } from '../../types/clinic';
import { CategoryInput, ServiceInput, deleteCategory, deleteService, saveCategory, saveService } from '../../services/api';
import { formatBRL } from '../../lib/format';
import { Field, Modal, Toggle, ImageField, errMsg, ghostBtn, inputClass, primaryBtn } from './ui';

interface Props {
  clinicId: string;
  categories: ServiceCategory[];
  services: Service[];
  professionals: Professional[];
  onChanged: () => Promise<void>;
  notify: (msg: string) => void;
  goToProfessionals: () => void;
}

const emptyService = (categoryId: string, professionals: Professional[]): ServiceInput => ({
  categoryId,
  name: '',
  description: '',
  durationMinutes: 60,
  priceCents: 0,
  recoveryInfo: '',
  requiresAnamnesis: false,
  badge: '',
  imageUrl: '',
  isActive: true,
  professionalIds: professionals.filter((p) => p.isActive).map((p) => p.id)
});

export function ServicesManager({ clinicId, categories, services, professionals, onChanged, notify, goToProfessionals }: Props) {
  const [serviceForm, setServiceForm] = useState<ServiceInput | null>(null);
  const [priceText, setPriceText] = useState('0');
  const [categoryForm, setCategoryForm] = useState<CategoryInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeProfessionals = professionals.filter((p) => p.isActive);

  const openNewService = (categoryId?: string) => {
    const first = categoryId ?? categories.find((c) => c.isActive)?.id ?? categories[0]?.id ?? '';
    setServiceForm(emptyService(first, professionals));
    setPriceText('0');
    setError(null);
  };

  const openEditService = (s: Service) => {
    setServiceForm({
      id: s.id,
      categoryId: s.categoryId,
      name: s.name,
      description: s.description,
      durationMinutes: s.durationMinutes,
      priceCents: s.priceCents,
      recoveryInfo: s.recoveryInfo,
      requiresAnamnesis: s.requiresAnamnesis,
      badge: s.badge ?? '',
      imageUrl: s.imageUrl ?? '',
      isActive: s.isActive,
      professionalIds: professionals.filter((p) => p.specialtyServiceIds.includes(s.id)).map((p) => p.id)
    });
    setPriceText((s.priceCents / 100).toFixed(2));
    setError(null);
  };

  const run = async (action: () => Promise<void>, success: string, close: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
      notify(success);
      close();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const submitService = () => {
    if (!serviceForm) return;
    const price = Number(priceText.replace(',', '.'));
    if (!serviceForm.name.trim()) return setError('Informe o nome do procedimento.');
    if (!serviceForm.categoryId) return setError('Escolha uma categoria (ou crie uma nova).');
    if (!Number.isFinite(price) || price < 0) return setError('Informe um preço válido.');
    if (!Number.isInteger(serviceForm.durationMinutes) || serviceForm.durationMinutes < 5) {
      return setError('A duração deve ser de pelo menos 5 minutos.');
    }
    const payload = { ...serviceForm, priceCents: Math.round(price * 100) };
    run(
      () => saveService(clinicId, payload),
      serviceForm.id ? 'Procedimento atualizado!' : 'Procedimento cadastrado!',
      () => setServiceForm(null)
    );
  };

  const removeService = (s: Service) => {
    if (!window.confirm(`Excluir "${s.name}"? Esta ação não pode ser desfeita.`)) return;
    run(() => deleteService(s.id), 'Procedimento excluído.', () => setServiceForm(null)).then(() => {});
  };

  const toggleVisible = async (s: Service) => {
    try {
      await saveService(clinicId, {
        id: s.id,
        categoryId: s.categoryId,
        name: s.name,
        description: s.description,
        durationMinutes: s.durationMinutes,
        priceCents: s.priceCents,
        recoveryInfo: s.recoveryInfo,
        requiresAnamnesis: s.requiresAnamnesis,
        badge: s.badge ?? '',
        imageUrl: s.imageUrl ?? '',
        isActive: !s.isActive,
        professionalIds: professionals.filter((p) => p.specialtyServiceIds.includes(s.id)).map((p) => p.id)
      });
      await onChanged();
      notify(s.isActive ? 'Procedimento escondido dos clientes.' : 'Procedimento visível para os clientes.');
    } catch (e) {
      notify(errMsg(e));
    }
  };

  const submitCategory = () => {
    if (!categoryForm) return;
    if (!categoryForm.name.trim()) return setError('Informe o nome da categoria.');
    run(
      () => saveCategory(clinicId, categoryForm),
      categoryForm.id ? 'Categoria atualizada!' : 'Categoria criada!',
      () => setCategoryForm(null)
    );
  };

  const removeCategory = () => {
    if (!categoryForm?.id) return;
    if (!window.confirm(`Excluir a categoria "${categoryForm.name}"?`)) return;
    run(() => deleteCategory(categoryForm.id!), 'Categoria excluída.', () => setCategoryForm(null));
  };

  const uncategorized = services.filter((s) => !categories.some((c) => c.id === s.categoryId));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Tag className="w-4 h-4 text-rose-400" /> Procedimentos & Preços
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            Tudo o que você cadastrar aqui aparece para os seus clientes na hora de agendar. Edite nome, descrição, valor e duração quando quiser.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setCategoryForm({ name: '', description: '', displayOrder: categories.length + 1, isActive: true });
              setError(null);
            }}
            className={ghostBtn}
          >
            <FolderPlus className="w-3.5 h-3.5" /> Nova categoria
          </button>
          <button onClick={() => openNewService()} className={primaryBtn} disabled={categories.length === 0}>
            <Plus className="w-3.5 h-3.5" /> Novo procedimento
          </button>
        </div>
      </div>

      {activeProfessionals.length === 0 && (
        <div className="flex items-start gap-2.5 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-xl p-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Você ainda não tem nenhuma profissional ativa. Os procedimentos só aparecem com horários para os clientes depois que houver
            pelo menos uma profissional com jornada cadastrada.{' '}
            <button onClick={goToProfessionals} className="underline font-semibold">
              Cadastrar profissionais
            </button>
          </span>
        </div>
      )}

      {categories.length === 0 && (
        <div className="bg-slate-900 border border-dashed border-slate-700 rounded-2xl p-8 text-center text-xs text-slate-400">
          Crie a primeira categoria (ex.: Facial, Corporal, Laser) para começar a cadastrar procedimentos.
        </div>
      )}

      {[...categories, ...(uncategorized.length ? [{ id: '__none', name: 'Sem categoria', description: '', displayOrder: 999, iconName: '', slug: '', isActive: true } as ServiceCategory] : [])].map((cat) => {
        const list = cat.id === '__none' ? uncategorized : services.filter((s) => s.categoryId === cat.id);
        return (
          <section key={cat.id} className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h4 className="text-sm font-bold text-white truncate">{cat.name}</h4>
                <span className="text-[10px] text-slate-500 font-mono">{list.length}</span>
                {!cat.isActive && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">Categoria oculta</span>
                )}
              </div>
              {cat.id !== '__none' && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openNewService(cat.id)} className="text-[11px] text-rose-300 hover:text-rose-200 font-semibold px-2 py-1">
                    + Procedimento
                  </button>
                  <button
                    onClick={() => {
                      setCategoryForm({
                        id: cat.id,
                        name: cat.name,
                        description: cat.description,
                        displayOrder: cat.displayOrder,
                        isActive: cat.isActive
                      });
                      setError(null);
                    }}
                    className="text-[11px] text-slate-400 hover:text-white px-2 py-1 flex items-center gap-1"
                    title="Editar categoria"
                  >
                    <Pencil className="w-3 h-3" /> Categoria
                  </button>
                </div>
              )}
            </div>

            {list.length === 0 ? (
              <p className="text-xs text-slate-500 bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                Nenhum procedimento nesta categoria ainda.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {list.map((s) => {
                  const proCount = professionals.filter((p) => p.specialtyServiceIds.includes(s.id) && p.isActive).length;
                  return (
                    <div
                      key={s.id}
                      className={`bg-slate-900 border rounded-2xl p-4 flex flex-col justify-between gap-3 ${
                        s.isActive ? 'border-slate-800' : 'border-slate-800/60 opacity-70'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h5 className="text-sm font-bold text-white leading-snug">{s.name}</h5>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            {!s.isActive && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1">
                                <EyeOff className="w-3 h-3" /> Oculto
                              </span>
                            )}
                            {s.badge && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30">{s.badge}</span>
                            )}
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed min-h-[2.2em]">
                          {s.description || 'Sem descrição.'}
                        </p>
                        <div className="flex items-center gap-3 text-xs bg-slate-950 border border-slate-800 rounded-xl px-3 py-2">
                          <span className="font-bold text-white">{formatBRL(s.priceCents)}</span>
                          <span className="text-slate-600">|</span>
                          <span className="text-slate-300 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-rose-400" /> {s.durationMinutes} min
                          </span>
                          <span className="text-slate-600">|</span>
                          <span className={`flex items-center gap-1 ${proCount ? 'text-slate-300' : 'text-amber-300'}`} title="Profissionais que realizam">
                            <Users className="w-3 h-3" /> {proCount}
                          </span>
                        </div>
                        {proCount === 0 && s.isActive && (
                          <p className="text-[11px] text-amber-300/90 leading-snug">
                            Sem profissional vinculada: não aparece com horários para o cliente.
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEditService(s)} className={primaryBtn + ' flex-1 !py-1.5'}>
                          <Pencil className="w-3 h-3" /> Editar
                        </button>
                        <button onClick={() => toggleVisible(s)} className={ghostBtn + ' !py-1.5 !px-3'}>
                          {s.isActive ? 'Ocultar' : 'Mostrar'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {/* ===== Modal: procedimento ===== */}
      {serviceForm && (
        <Modal
          size="lg"
          title={serviceForm.id ? 'Editar procedimento' : 'Novo procedimento'}
          subtitle="O cliente vê nome, descrição, valor e duração na hora de agendar."
          onClose={() => !busy && setServiceForm(null)}
          footer={
            <>
              {serviceForm.id && (
                <button
                  onClick={() => removeService(services.find((x) => x.id === serviceForm.id)!)}
                  disabled={busy}
                  className="mr-auto px-3 py-2 rounded-xl text-xs font-semibold text-rose-300 hover:bg-rose-500/10 flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Excluir
                </button>
              )}
              <button onClick={() => setServiceForm(null)} disabled={busy} className={ghostBtn}>
                Cancelar
              </button>
              <button onClick={submitService} disabled={busy} className={primaryBtn}>
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar
              </button>
            </>
          }
        >
          {error && <ErrorBox text={error} />}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nome do procedimento *" className="sm:col-span-2">
              <input
                value={serviceForm.name}
                onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })}
                placeholder="Ex.: Limpeza de Pele Profunda"
                maxLength={150}
                className={inputClass}
              />
            </Field>
            <Field label="Categoria *">
              <select
                value={serviceForm.categoryId}
                onChange={(e) => setServiceForm({ ...serviceForm, categoryId: e.target.value })}
                className={inputClass}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Selo de destaque (opcional)" hint='Ex.: "Mais Procurado", "Novidade"'>
              <input
                value={serviceForm.badge}
                onChange={(e) => setServiceForm({ ...serviceForm, badge: e.target.value })}
                maxLength={50}
                className={inputClass}
              />
            </Field>
            <Field label="Preço (R$) *">
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Duração (minutos) *">
              <input
                type="number"
                min={5}
                step={5}
                value={serviceForm.durationMinutes}
                onChange={(e) => setServiceForm({ ...serviceForm, durationMinutes: Number(e.target.value) })}
                className={inputClass}
              />
            </Field>
            <Field label="Descrição" className="sm:col-span-2" hint="Explique o que é o procedimento e seus benefícios.">
              <textarea
                rows={3}
                value={serviceForm.description}
                onChange={(e) => setServiceForm({ ...serviceForm, description: e.target.value })}
                className={inputClass + ' resize-y'}
              />
            </Field>
            <Field label="Orientações pós-procedimento (opcional)" className="sm:col-span-2" hint="Aparece para o cliente na confirmação do agendamento.">
              <textarea
                rows={2}
                value={serviceForm.recoveryInfo}
                onChange={(e) => setServiceForm({ ...serviceForm, recoveryInfo: e.target.value })}
                className={inputClass + ' resize-y'}
              />
            </Field>
          </div>

          <ImageField
            clinicId={clinicId}
            label="Foto do procedimento (opcional)"
            value={serviceForm.imageUrl}
            onChange={(url) => setServiceForm({ ...serviceForm, imageUrl: url })}
          />

          <div className="space-y-3 border-t border-slate-800 pt-4">
            <Toggle
              checked={serviceForm.requiresAnamnesis}
              onChange={(v) => setServiceForm({ ...serviceForm, requiresAnamnesis: v })}
              label="Exige ficha de anamnese"
              hint="O cliente precisa preencher a ficha de saúde antes de confirmar."
            />
            <Toggle
              checked={serviceForm.isActive}
              onChange={(v) => setServiceForm({ ...serviceForm, isActive: v })}
              label="Visível para os clientes"
              hint="Desative para esconder sem perder o histórico de atendimentos."
            />
          </div>

          <div className="border-t border-slate-800 pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300">Quem realiza este procedimento?</span>
              {professionals.length > 0 && (
                <button
                  type="button"
                  className="text-[11px] text-rose-300 hover:text-rose-200"
                  onClick={() =>
                    setServiceForm({
                      ...serviceForm,
                      professionalIds:
                        serviceForm.professionalIds.length === activeProfessionals.length ? [] : activeProfessionals.map((p) => p.id)
                    })
                  }
                >
                  {serviceForm.professionalIds.length === activeProfessionals.length ? 'Desmarcar todas' : 'Marcar todas'}
                </button>
              )}
            </div>
            {professionals.length === 0 ? (
              <p className="text-[11px] text-amber-300">Cadastre uma profissional primeiro (aba "Profissionais & Horários"). Você poderá vincular depois.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {professionals.map((p) => {
                  const checked = serviceForm.professionalIds.includes(p.id);
                  return (
                    <label
                      key={p.id}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer text-xs ${
                        checked ? 'border-rose-500/50 bg-rose-500/10 text-white' : 'border-slate-800 bg-slate-950 text-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        className="accent-rose-500"
                        onChange={() =>
                          setServiceForm({
                            ...serviceForm,
                            professionalIds: checked
                              ? serviceForm.professionalIds.filter((id) => id !== p.id)
                              : [...serviceForm.professionalIds, p.id]
                          })
                        }
                      />
                      <span className="truncate">{p.name}</span>
                      {!p.isActive && <span className="text-[10px] text-slate-500">(inativa)</span>}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ===== Modal: categoria ===== */}
      {categoryForm && (
        <Modal
          title={categoryForm.id ? 'Editar categoria' : 'Nova categoria'}
          onClose={() => !busy && setCategoryForm(null)}
          footer={
            <>
              {categoryForm.id && (
                <button
                  onClick={removeCategory}
                  disabled={busy}
                  className="mr-auto px-3 py-2 rounded-xl text-xs font-semibold text-rose-300 hover:bg-rose-500/10 flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Excluir
                </button>
              )}
              <button onClick={() => setCategoryForm(null)} disabled={busy} className={ghostBtn}>
                Cancelar
              </button>
              <button onClick={submitCategory} disabled={busy} className={primaryBtn}>
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar
              </button>
            </>
          }
        >
          {error && <ErrorBox text={error} />}
          <Field label="Nome da categoria *">
            <input
              value={categoryForm.name}
              onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
              placeholder="Ex.: Facial & Rejuvenescimento"
              maxLength={100}
              className={inputClass}
            />
          </Field>
          <Field label="Descrição (opcional)">
            <input
              value={categoryForm.description}
              onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Posição na lista" hint="Categorias com número menor aparecem primeiro.">
            <input
              type="number"
              min={0}
              value={categoryForm.displayOrder}
              onChange={(e) => setCategoryForm({ ...categoryForm, displayOrder: Number(e.target.value) })}
              className={inputClass}
            />
          </Field>
          <Toggle
            checked={categoryForm.isActive}
            onChange={(v) => setCategoryForm({ ...categoryForm, isActive: v })}
            label="Categoria visível"
            hint="Desmarcada, ela some do filtro dos clientes."
          />
        </Modal>
      )}
    </div>
  );
}

export function ErrorBox({ text }: { text: string }) {
  return (
    <div className="text-xs text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 leading-snug">{text}</div>
  );
}
