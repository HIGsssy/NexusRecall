interface Props {
  personaPrompt: string;
  onChange: (prompt: string) => void;
  disabled?: boolean;
}

export function PersonaEditor({ personaPrompt, onChange, disabled }: Props) {
  return (
    <div className="panel persona-editor">
      <h3>Persona Prompt</h3>
      <textarea
        value={personaPrompt}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={6}
        placeholder="Enter system persona prompt..."
      />
    </div>
  );
}
