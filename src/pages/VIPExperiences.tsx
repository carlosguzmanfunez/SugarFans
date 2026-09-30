import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import BookingCalendar from '../components/BookingCalendar';
import { formatLongDate, DEFAULT_AVAILABILITY, EXPERIENCE_TYPES, type Availability, type TakenSlot, type VipExperience } from '../lib/vip';
import { backend } from '../lib/backend';
import { usePlatformQuery } from '../lib/platform';
import { useCreatorCatalog } from '../lib/catalog';

const VIPExperiences: React.FC = () => {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('');
  const [bookingMessage, setBookingMessage] = useState('');
  const [bookingError, setBookingError] = useState('');
  const [bookingDone, setBookingDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [availability, setAvailability] = useState<Availability>(DEFAULT_AVAILABILITY);
  const [taken, setTaken] = useState<TakenSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedExperience, setSelectedExperience] = useState<VipExperience | null>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const { data: experiences, loading } = usePlatformQuery(() => backend.listExperiences(), [], [] as VipExperience[]);
  const { creators } = useCreatorCatalog();
  const creatorOf = (exp: VipExperience) => creators.find((c) => c.id === exp.creatorProfileId);

  const experienceTypes = [{ id: 'all', name: 'Todas', icon: '✨' }, ...EXPERIENCE_TYPES];

  const active = experiences.filter((e) => e.active);
  const filteredExperiences = selectedType === 'all' ? active : active.filter((exp) => exp.type === selectedType);

  const handleBookExperience = (experience: VipExperience) => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    if (user?.creatorProfileId === experience.creatorProfileId) {
      alert('No puedes reservar tu propia experiencia');
      return;
    }
    setSelectedExperience(experience);
    setBookingDate('');
    setBookingTime('');
    setBookingMessage('');
    setBookingError('');
    setBookingDone(false);
    setShowBookingModal(true);
    setSlotsLoading(true);
    Promise.all([backend.getAvailability(experience.creatorProfileId), backend.takenSlots(experience.creatorProfileId)]).then(([a, t]) => {
      setAvailability(a);
      setTaken(t);
      setSlotsLoading(false);
    });
  };

  const handleConfirmBooking = async () => {
    if (!selectedExperience || !user) return;
    setSubmitting(true);
    const result = await backend.createBooking(user, {
      experienceId: selectedExperience.id,
      date: bookingDate,
      time: bookingTime,
      message: bookingMessage.trim(),
    });
    setSubmitting(false);
    if (!result.ok) {
      setBookingError(result.error || 'No se pudo enviar la reserva');
      // Someone may have taken the slot meanwhile: refresh what is free.
      backend.takenSlots(selectedExperience.creatorProfileId).then(setTaken);
      return;
    }
    setBookingError('');
    setBookingDone(true);
  };

  const typeOf = (type: string) => EXPERIENCE_TYPES.find((t) => t.id === type) ?? { icon: '✨', name: type };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-yellow-50">
      {/* Hero Section */}
      <div className="relative bg-gradient-to-r from-purple-600 via-pink-600 to-yellow-500 text-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 relative z-10">
          <div className="text-center">
            <div className="inline-block mb-4">
              <span className="text-6xl">👑</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              Experiencias VIP
            </h1>
            <p className="text-xl text-white/90 max-w-2xl mx-auto">
              Vive momentos únicos y exclusivos con tus creadores favoritos.
              Reserva día y hora, el creador confirma y la sesión es en vivo dentro de SugarFans.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Filters */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Filtra por Tipo de Experiencia</h2>
          <div className="flex flex-wrap gap-3">
            {experienceTypes.map((type) => (
              <button
                key={type.id}
                onClick={() => setSelectedType(type.id)}
                className={`px-5 py-3 rounded-xl font-medium transition-all ${
                  selectedType === type.id
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg scale-105'
                    : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                <span className="mr-2">{type.icon}</span>
                {type.name}
              </button>
            ))}
          </div>
        </div>

        {/* Experiences Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredExperiences.map((experience) => (
            <div
              key={experience.id}
              className="bg-white rounded-2xl shadow-lg overflow-hidden hover:shadow-2xl transition-all transform hover:-translate-y-1"
            >
              {/* Image */}
              <div className="relative h-48 overflow-hidden">
                <img
                  src={experience.image}
                  alt={experience.title}
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-3 right-3">
                  <span className="bg-white/90 backdrop-blur-sm text-purple-700 px-3 py-1 rounded-full text-sm font-semibold">
                    {typeOf(experience.type).icon} {typeOf(experience.type).name}
                  </span>
                </div>
              </div>

              {/* Content */}
              <div className="p-6">
                {/* Creator Info */}
                <Link to={`/creator/${experience.creatorProfileId}`} className="flex items-center mb-3">
                  {creatorOf(experience)?.avatar && (
                    <img
                      src={creatorOf(experience)!.avatar}
                      alt={experience.creatorName}
                      className="w-10 h-10 rounded-full border-2 border-purple-200 mr-3"
                    />
                  )}
                  <p className="font-semibold text-gray-900">
                    {experience.creatorName}
                  </p>
                </Link>

                {/* Title & Description */}
                <h3 className="text-xl font-bold text-gray-900 mb-2">{experience.title}</h3>
                <p className="text-gray-600 text-sm mb-4 line-clamp-2">{experience.description}</p>

                {/* Duration */}
                <div className="flex items-center text-sm text-gray-600 mb-4">
                  <i className="fas fa-clock mr-2 text-purple-600"></i>
                  {experience.durationMinutes ? `${experience.durationMinutes} min en vivo` : 'Sin sesión en vivo'}
                </div>

                {/* Price & Book Button */}
                <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                  <div>
                    <span className="text-3xl font-bold text-purple-600">${experience.price}</span>
                    <span className="text-gray-500 text-sm ml-1">USD</span>
                  </div>
                  <button
                      onClick={() => handleBookExperience(experience)}
                      className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-6 py-3 rounded-xl font-semibold hover:shadow-lg transition-all"
                    >
                      Reservar Ahora
                    </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        {!loading && filteredExperiences.length === 0 && (
          <p className="text-center text-gray-500 py-12">Todavía no hay experiencias de este tipo.</p>
        )}

        {/* Benefits Section */}
        <div className="mt-16 bg-white rounded-3xl shadow-xl p-8 md:p-12">
          <h2 className="text-3xl font-bold text-center mb-8 text-gray-900">
            ¿Por qué elegir Experiencias VIP?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-star text-white text-2xl"></i>
              </div>
              <h3 className="text-xl font-bold mb-2">Exclusividad Total</h3>
              <p className="text-gray-600">
                Accede a experiencias únicas diseñadas específicamente para ti. Sin multitudes, sin distracciones.
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-pink-500 to-yellow-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-heart text-white text-2xl"></i>
              </div>
              <h3 className="text-xl font-bold mb-2">Conexión Real</h3>
              <p className="text-gray-600">
                Conecta directamente con tus creadores favoritos en un ambiente íntimo y personalizado.
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-yellow-500 to-purple-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-shield-alt text-white text-2xl"></i>
              </div>
              <h3 className="text-xl font-bold mb-2">Pago seguro</h3>
              <p className="text-gray-600">
                Solo pagas cuando el creador acepta tu reserva, y la sesión en vivo es privada entre tú y el creador.
              </p>
            </div>
          </div>
        </div>

        {/* How it Works */}
        <div className="mt-16">
          <h2 className="text-3xl font-bold text-center mb-12 text-gray-900">
            ¿Cómo Funciona?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl font-bold text-purple-600">1</span>
              </div>
              <h3 className="font-bold text-lg mb-2">Explora</h3>
              <p className="text-gray-600 text-sm">
                Descubre experiencias únicas de tus creadores favoritos
              </p>
            </div>
            <div className="text-center">
              <div className="w-20 h-20 bg-pink-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl font-bold text-pink-600">2</span>
              </div>
              <h3 className="font-bold text-lg mb-2">Reserva</h3>
              <p className="text-gray-600 text-sm">
                Selecciona tu fecha y hora preferida
              </p>
            </div>
            <div className="text-center">
              <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl font-bold text-yellow-600">3</span>
              </div>
              <h3 className="font-bold text-lg mb-2">Confirma</h3>
              <p className="text-gray-600 text-sm">
                Recibe confirmación y detalles de tu experiencia
              </p>
            </div>
            <div className="text-center">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl font-bold text-green-600">4</span>
              </div>
              <h3 className="font-bold text-lg mb-2">Disfruta</h3>
              <p className="text-gray-600 text-sm">
                Vive una experiencia inolvidable y personalizada
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Booking Modal */}
      {showBookingModal && selectedExperience && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {bookingDone ? (
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <i className="fas fa-check text-2xl text-green-600"></i>
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">¡Reserva enviada!</h2>
                <p className="text-gray-600 mb-2">
                  {selectedExperience.title} · <span className="first-letter:uppercase">{formatLongDate(bookingDate)}</span> · {bookingTime}
                </p>
                <p className="text-sm text-gray-500 mb-6">
                  {selectedExperience.creatorName} debe aceptarla. Después podrás pagar desde tu perfil y te enviaremos el correo de confirmación.
                </p>
                <div className="flex gap-3 justify-center">
                  <button onClick={() => setShowBookingModal(false)} className="px-6 py-3 border border-gray-300 rounded-xl font-semibold text-gray-700 hover:bg-gray-50">
                    Cerrar
                  </button>
                  <Link to="/profile" className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-semibold">
                    Ver mis reservas
                  </Link>
                </div>
              </div>
            ) : (
            <div className="p-6 md:p-8">
              {/* Header */}
              <div className="flex justify-between items-start mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Reservar Experiencia VIP</h2>
                <button
                  onClick={() => setShowBookingModal(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>

              {/* Experience Summary */}
              <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-2xl p-6 mb-6">
                <div className="flex items-start gap-4">
                  <img
                    src={selectedExperience.image}
                    alt={selectedExperience.title}
                    className="w-24 h-24 rounded-xl object-cover"
                  />
                  <div className="flex-1">
                    <h3 className="font-bold text-lg mb-1">{selectedExperience.title}</h3>
                    <p className="text-gray-600 text-sm mb-2">con {selectedExperience.creatorName}</p>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-purple-600 font-semibold">
                        ${selectedExperience.price} USD
                      </span>
                      {selectedExperience.durationMinutes && (
                        <span className="text-gray-600">
                          <i className="fas fa-clock mr-1"></i>
                          {selectedExperience.durationMinutes} min
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Booking Form */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Elige día y hora
                  </label>
                  {slotsLoading ? (
                    <p className="text-sm text-gray-500 py-6 text-center">Cargando horarios…</p>
                  ) : (
                  <BookingCalendar
                    availability={availability}
                    taken={taken}
                    creatorName={selectedExperience.creatorName}
                    date={bookingDate}
                    time={bookingTime}
                    onChange={(d, h) => {
                      setBookingDate(d);
                      setBookingTime(h);
                      setBookingError('');
                    }}
                  />
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Mensaje para el Creador (Opcional)
                  </label>
                  <textarea
                    rows={4}
                    name="message"
                    value={bookingMessage}
                    onChange={(e) => setBookingMessage(e.target.value)}
                    placeholder="Cuéntale al creador qué te gustaría hacer en esta experiencia..."
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  ></textarea>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <i className="fas fa-info-circle text-yellow-600 mt-1"></i>
                    <div className="text-sm text-yellow-800">
                      <p className="font-semibold mb-1">Importante:</p>
                      <ul className="list-disc list-inside space-y-1">
                        <li>{selectedExperience.creatorName} revisa y acepta tu solicitud</li>
                        <li>Una vez aceptada, realizas el pago de forma segura desde tu perfil</li>
                        <li>Con el pago completado recibirás el correo de confirmación</li>
                        <li>Política de reembolso disponible en términos</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              {bookingError && (
                <div role="alert" className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                  {bookingError}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowBookingModal(false)}
                  className="flex-1 px-6 py-3 border border-gray-300 rounded-xl font-semibold text-gray-700 hover:bg-gray-50 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmBooking}
                  disabled={submitting}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-semibold hover:shadow-lg transition"
                >
                  Confirmar Reserva
                </button>
              </div>
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VIPExperiences;
