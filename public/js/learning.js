// Uses existing documents only; learning answers stay in this page's memory.
const learningTopics = [
  {title:'Mein erstes Event', words:['leitfaden','event','ablauf','rentman'], prompts:['Wie bereitest du dich laut Anleitung auf deinen Einsatz vor?', 'Welche Aufgaben und Ansprechpartner musst du vor Beginn kennen?', 'Welche Frage möchtest du vor Ort noch klären?']},
  {title:'Rezepte üben', words:['rezept','cocktail','kaffee','barista','smoothie','matcha'], prompts:['Welche Zutaten und exakten Mengen nennt das Rezept?', 'In welcher Reihenfolge und mit welcher Technik bereitest du das Getränk zu?', 'Welches Glas, welche Garnitur und welche Qualitätsmerkmale sind vorgegeben?']},
  {title:'Aufbau & Geräte', words:['aufbau','abbau','gerät','maschine','anleitung','datenblatt','bar'], prompts:['Welche Vorbereitung nennt die Anleitung?', 'Welche Arbeitsschritte musst du in welcher Reihenfolge ausführen?', 'Wann sollst du stoppen und eine zuständige Person hinzuziehen?']},
  {title:'Sicher arbeiten', words:['sicherheit','hygiene','allergen','notfall','reinigung'], prompts:['Welche Vorgaben nennt das Dokument für deine Tätigkeit?', 'Was musst du vor Beginn kontrollieren?', 'Was tust du laut Dokument bei Unklarheiten oder Problemen?']}
];
let learningTopic = 0;
function matchingLearningDocuments(index) {
  const topic = learningTopics[index];
  return allDocuments.filter(doc => {
    let folder = allFolders.find(f => f.id === doc.folder_id);
    let names = ''; const seen = new Set();
    while(folder && !seen.has(folder.id)) {seen.add(folder.id);names += ' '+folder.name;folder=allFolders.find(f=>f.id===folder.parent_id);}
    const text = `${doc.original_name} ${doc.description || ''} ${names}`.toLowerCase();
    return topic.words.some(word => text.includes(word));
  });
}
function renderLearningHub() {
  const hub = document.getElementById('learningHub');
  hub.innerHTML = `<div class="learn-card"><h2>Wissen für deinen nächsten Einsatz</h2><p>Neu im Team? Entdecke passende Unterlagen und übe Schritt für Schritt. Im Event kannst du unten direkt nachschlagen.</p><div class="learn-actions">${learningTopics.map((t,i)=>`<button class="btn ${i===learningTopic?'btn-primary':'btn-secondary'}" aria-pressed="${i===learningTopic}" onclick="chooseLearningTopic(${i})">${t.title}</button>`).join('')}</div><div id="learningContent"></div></div>`;
  renderLearningTopic();
}
function chooseLearningTopic(index) {learningTopic=index;renderLearningHub();}
function renderLearningTopic() {
  const docs = matchingLearningDocuments(learningTopic);
  document.getElementById('learningContent').innerHTML = `<p>Passende Unterlagen anhand von Dateiname, Beschreibung und Ordner.</p>${docs.length ? `<label for="learningDocument">Was möchtest du lernen?</label><select id="learningDocument" onchange="resetLearningExercise()">${docs.map(d=>`<option value="${d.id}">${escHtml(d.original_name)}</option>`).join('')}</select><div class="learn-actions"><button class="btn btn-primary" onclick="startLearningExercise()">Lernrunde starten</button><button class="btn btn-secondary" onclick="openLearningDocument()">Unterlage ansehen ↗</button></div>` : '<p>Hier sind noch keine passenden Unterlagen hinterlegt. Alle verfügbaren Dateien findest du unten. Frage eure Einsatzleitung nach dem aktuellen Dokument.</p>'}<div id="learningExercise"></div>`;
}
function resetLearningExercise(){document.getElementById('learningExercise').innerHTML='';}
function openLearningDocument(){const id=Number(document.getElementById('learningDocument').value);window.open(`/api/documents/${id}/view`,'_blank','noopener');}
function startLearningExercise(){
  document.getElementById('learningExercise').innerHTML = `<p><strong>1. Lesen</strong> · Öffne die Unterlage. Lies einen überschaubaren Abschnitt und kehre hierher zurück.</p><p><strong>2. Erinnern</strong> · Beantworte die Fragen zunächst aus dem Gedächtnis.</p>${learningTopics[learningTopic].prompts.map((q,i)=>`<label for="learningAnswer${i}">${escHtml(q)}</label><textarea id="learningAnswer${i}" placeholder="Deine Antwort – nur für dich"></textarea>`).join('')}<details><summary>3. Mit der Unterlage vergleichen</summary><p>Öffne das Original erneut und prüfe jede Antwort. Ergänze fehlende Angaben. Stimmen bei Rezepten auch Mengen, Reihenfolge und Präsentation?</p><button class="btn btn-secondary" onclick="openLearningDocument()">Original öffnen ↗</button><p>Unsicher? Notiere deine Frage und kläre sie mit der Einsatzleitung. Eine Lernrunde ersetzt keine praktische Einweisung.</p><button class="btn btn-primary" onclick="finishLearningExercise()">Selbstvergleich abgeschlossen</button></details><p>Deine Antworten werden nicht gespeichert oder an den Admin gesendet. Beim Themenwechsel oder Neuladen werden sie verworfen.</p>`;
}
function finishLearningExercise(){
 const exercise=document.getElementById('learningExercise');
 exercise.innerHTML='<p role="status"><strong>Lernrunde abgeschlossen.</strong> Übe den Ablauf bei Gelegenheit gemeinsam mit einer erfahrenen Person. Wiederhole ihn später ohne nachzulesen.</p><button class="btn btn-secondary" onclick="startLearningExercise()">Noch einmal üben</button>';
}
