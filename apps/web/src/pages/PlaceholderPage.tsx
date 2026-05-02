export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="panel">
      <div className="section-title">{title}</div>
      <div className="empty-state">
        Esta pagina ja esta preparada no React. A proxima etapa e migrar os controles finos do painel antigo para ca.
      </div>
    </section>
  );
}
