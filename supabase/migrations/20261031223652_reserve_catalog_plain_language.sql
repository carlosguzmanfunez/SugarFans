-- Approved pilot copy only. Match the exact previous source, not generated ids.
-- No deletion: old bookings keep their original titles, terms and financial records.
-- Prices, dates, approval rules, locations and payout controls are unchanged.
update public.vip_experiences e
set title = c.new_title, description = c.new_description
from (values
  ('Valentina Rose', 'video-call', 'Videollamada 1:1', 'Videollamada privada dentro de Fans Reserve para hablar de moda, estilo y backstage. Tú propones el tema y yo traigo consejos y respuestas.', 'Videollamada 1:1', 'Videollamada dentro de Fans Reserve para conversar sobre moda, estilo y el trabajo creativo. Tú propones el tema y el creador comparte consejos y respuestas.'),
  ('Diego Torres', 'coaching', 'Coaching y plan de entrenamiento', 'Sesión de coaching por video en la que diseño un plan de entrenamiento específico para tus objetivos.', 'Asesoría y plan de entrenamiento', 'Asesoría por video para diseñar un plan de entrenamiento según tu nivel y tus objetivos.'),
  ('Sofía Luna', 'art-class', 'Clase de arte digital', 'Clase privada en la que te enseño técnicas de arte digital según tu nivel y preferencias.', 'Clase de arte digital', 'Aprende técnicas de arte digital por video, con explicaciones y ejercicios adecuados a tu nivel y tus intereses.'),
  ('Camila Reyes', 'cooking-class', 'Clase de cocina en vivo', 'Clase por video en la que cocinamos juntos una receta exclusiva. Incluye lista de ingredientes y tips profesionales.', 'Clase de cocina en vivo', 'Cocina una receta paso a paso con el creador por video. Incluye una lista de ingredientes y consejos de preparación.'),
  ('Valentina Rose', 'meet-greet', 'Meet & Greet en Miami', 'Saludo y fotos con tu creador de contenido en un venue público de Miami, durante mi agenda de eventos. El lugar exacto se confirma con la reserva.', 'Saludo y fotos contigo', 'Saluda a tu creador y tómate unas fotos durante una actividad programada en un lugar público de Miami.'),
  ('Valentina Rose', 'fashion-beauty-talk', 'Fashion & beauty talk', 'Veinte minutos por video para revisar tu estilo, tu rutina de belleza y tus dudas de moda.', 'Charla de moda y belleza', 'Conversemos sobre estilos, tendencias y consejos para encontrar lo que mejor va contigo.'),
  ('Diego Torres', 'training-1-1', 'Entrenamiento en gimnasio', 'Entrenamiento 1:1 en un gimnasio de Ciudad de México: técnica, rutina y correcciones en directo.', 'Entrenamiento en gimnasio', 'Entrenamiento guiado en un gimnasio de Ciudad de México, con ejercicios, revisión de técnica y correcciones durante la actividad.'),
  ('Valentina Rose', 'qa-session', 'Beauty Q&A con Valentina', 'Q&A grupal en vivo sobre maquillaje, cuidado de la piel y rutinas. Envías tus preguntas por el chat y Valentina responde en directo.', 'Preguntas y respuestas sobre belleza', 'Trae tus preguntas sobre maquillaje, cuidado personal y rutinas de belleza. Valentina responde en vivo a las preguntas del grupo por el chat.'),
  ('Carlos Roberto Guzman Funez', 'live-1-1', 'Platicas', 'Pláticas de interés', 'Platiquemos de lo que te interesa', 'Una conversación en vivo 1:1 con tu creador favorito sobre intereses compartidos, sus proyectos y las preguntas que siempre quisiste hacerle.')
) as c(creator_name, type, old_title, old_description, new_title, new_description)
where e.creator_name = c.creator_name and e.type = c.type
  and e.title = c.old_title and e.description = c.old_description;

-- Retire this one sample offer, retaining it for historical references.
update public.vip_experiences set active = false
where creator_name = 'Mariana Silva' and type = 'early-access'
  and title = 'Acceso anticipado a mi próximo proyecto'
  and description = 'Acceso anticipado a mi próximo proyecto de baile y un video exclusivo del proceso creativo, entregado en la app.'
  and active;
