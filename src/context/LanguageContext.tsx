import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { BRAND } from '../config/brand';

const LANGUAGE_KEY = `${BRAND.storagePrefix}language`;

export type Language = 'es' | 'en' | 'pt' | 'fr' | 'it';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

// Detect browser language
// Only languages the whole site is written in are offered. Most pages exist only
// in Spanish, so the others stay off until those pages are translated; add them
// back here to bring the selector back.
export const ENABLED_LANGUAGES: Language[] = ['es'];

const detectLanguage = (): Language => {
  const saved = localStorage.getItem(LANGUAGE_KEY) as Language;
  if (saved && ENABLED_LANGUAGES.includes(saved)) return saved;
  const browserLang = (navigator.language || '').split('-')[0].toLowerCase() as Language;
  return ENABLED_LANGUAGES.includes(browserLang) ? browserLang : 'es';
};

// Translations
const translations: Record<Language, Record<string, string>> = {
  es: {
    // Navbar
    'nav.explore': 'Explorar',
    'nav.dashboard': 'Panel',
    'nav.admin': 'Admin',
    'nav.profile': 'Mi perfil',
    'nav.settings': 'Configuración',
    'nav.help': 'Ayuda',
    'nav.logout': 'Cerrar sesión',
    'nav.login': 'Iniciar sesión',
    'nav.register': 'Crear cuenta',
    
    // Age verification
    'age.title': 'Verificación de edad',
    'age.description': '{brand} es para mayores de 18 años porque aquí se hacen pagos y reservas directamente con creadores. Confirma tu edad para continuar.',
    'age.warning': 'Aviso legal',
    'age.warningText': 'Al ingresar, declaras bajo juramento que tienes 18 años o más. El acceso a menores está estrictamente prohibido.',
    'age.confirm': 'Sí, soy mayor de 18 años',
    'age.deny': 'No, soy menor de 18 años',
    'age.denied.title': 'Acceso denegado',
    'age.denied.text': 'Lo sentimos, debes ser mayor de 18 años para acceder a {brand}. Serás redirigido en unos momentos.',
    'age.denied.button': 'Salir del sitio',
    'age.terms': 'Al continuar, aceptas nuestros',
    'age.termsLink': 'Términos de Servicio',
    'age.and': 'y',
    'age.privacyLink': 'Política de Privacidad',
    
    // Login
    'login.title': 'Bienvenido de vuelta',
    'login.subtitle': 'Inicia sesión en tu cuenta',
    'login.email': 'Correo electrónico',
    'login.password': 'Contraseña',
    'login.remember': 'Recordarme',
    'login.forgot': '¿Olvidaste tu contraseña?',
    'login.submit': 'Iniciar sesión',
    'login.or': 'o continúa con',
    'login.noAccount': '¿No tienes cuenta?',
    'login.register': 'Regístrate gratis',
    'login.demo': 'Acceso demo',
    
    // Register
    'register.createAccount': 'Crear cuenta',
    'register.security': 'Seguridad',
    'register.accountType': 'Tipo de cuenta',
    'register.basicInfo': 'Ingresa tus datos básicos',
    'register.passwordInfo': 'Crea una contraseña segura',
    'register.howToUse': '¿Cómo quieres usar {brand}?',
    'register.fullName': 'Nombre completo',
    'register.email': 'Correo electrónico',
    'register.password': 'Contraseña',
    'register.confirmPassword': 'Confirmar contraseña',
    'register.continue': 'Continuar',
    'register.back': 'Atrás',
    'register.fan': 'Fan',
    'register.fanDesc': 'Ver y apoyar creadores',
    'register.creator': 'Creador',
    'register.creatorDesc': 'Publicar y monetizar',
    'register.terms': 'Acepto los',
    'register.termsLink': 'Términos de Servicio',
    'register.and': 'la',
    'register.privacyLink': 'Política de Privacidad',
    'register.ageConfirm': 'y confirmo que soy mayor de 18 años.',
    'register.submit': 'Crear cuenta',
    'register.hasAccount': '¿Ya tienes cuenta?',
    'register.login': 'Inicia sesión',
    
    // Common
    'common.perMonth': '/mes',
    'common.followers': 'Seguidores',
    'common.posts': 'Publicaciones',
    'common.likes': 'Me gusta',
    'common.subscribe': 'Suscribirse',
    'common.subscribed': 'Suscrito',
    'common.unlock': 'Desbloquear',
    'common.exclusiveContent': 'Contenido exclusivo',
    'common.tip': 'Propina',
    'common.share': 'Compartir',
    'common.report': 'Reportar',
    'common.save': 'Guardar',
    'common.cancel': 'Cancelar',
    'common.delete': 'Eliminar',
    'common.edit': 'Editar',
    'common.view': 'Ver',
    'common.all': 'Todos',
  },
  
  en: {
    // Navbar
    'nav.explore': 'Explore',
    'nav.dashboard': 'Dashboard',
    'nav.admin': 'Admin',
    'nav.profile': 'My profile',
    'nav.settings': 'Settings',
    'nav.help': 'Help',
    'nav.logout': 'Log out',
    'nav.login': 'Log in',
    'nav.register': 'Sign up',
    
    // Age verification
    'age.title': 'Age verification',
    'age.description': '{brand} is for people 18 and over because payments and bookings are made directly with creators. Please confirm your age to continue.',
    'age.warning': 'Legal notice',
    'age.warningText': 'By entering, you declare under oath that you are 18 years or older. Access by minors is strictly prohibited.',
    'age.confirm': 'Yes, I am over 18 years old',
    'age.deny': 'No, I am under 18 years old',
    'age.denied.title': 'Access denied',
    'age.denied.text': 'Sorry, you must be over 18 years old to access {brand}. You will be redirected in a moment.',
    'age.denied.button': 'Exit site',
    'age.terms': 'By continuing, you accept our',
    'age.termsLink': 'Terms of Service',
    'age.and': 'and',
    'age.privacyLink': 'Privacy Policy',
    
    // Login
    'login.title': 'Welcome back',
    'login.subtitle': 'Log in to your account',
    'login.email': 'Email address',
    'login.password': 'Password',
    'login.remember': 'Remember me',
    'login.forgot': 'Forgot your password?',
    'login.submit': 'Log in',
    'login.or': 'or continue with',
    'login.noAccount': 'Don\'t have an account?',
    'login.register': 'Sign up for free',
    'login.demo': 'Demo access',
    
    // Register
    'register.createAccount': 'Create account',
    'register.security': 'Security',
    'register.accountType': 'Account type',
    'register.basicInfo': 'Enter your basic information',
    'register.passwordInfo': 'Create a secure password',
    'register.howToUse': 'How do you want to use {brand}?',
    'register.fullName': 'Full name',
    'register.email': 'Email address',
    'register.password': 'Password',
    'register.confirmPassword': 'Confirm password',
    'register.continue': 'Continue',
    'register.back': 'Back',
    'register.fan': 'Fan',
    'register.fanDesc': 'View and support creators',
    'register.creator': 'Creator',
    'register.creatorDesc': 'Publish and monetize',
    'register.terms': 'I accept the',
    'register.termsLink': 'Terms of Service',
    'register.and': 'the',
    'register.privacyLink': 'Privacy Policy',
    'register.ageConfirm': 'and I confirm that I am over 18 years old.',
    'register.submit': 'Create account',
    'register.hasAccount': 'Already have an account?',
    'register.login': 'Log in',
    
    // Common
    'common.perMonth': '/month',
    'common.followers': 'Followers',
    'common.posts': 'Posts',
    'common.likes': 'Likes',
    'common.subscribe': 'Subscribe',
    'common.subscribed': 'Subscribed',
    'common.unlock': 'Unlock',
    'common.exclusiveContent': 'Exclusive content',
    'common.tip': 'Tip',
    'common.share': 'Share',
    'common.report': 'Report',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.view': 'View',
    'common.all': 'All',
  },
  
  pt: {
    // Navbar
    'nav.explore': 'Explorar',
    'nav.dashboard': 'Painel',
    'nav.admin': 'Admin',
    'nav.profile': 'Meu perfil',
    'nav.settings': 'Configurações',
    'nav.help': 'Ajuda',
    'nav.logout': 'Sair',
    'nav.login': 'Entrar',
    'nav.register': 'Cadastrar',
    
    // Age verification
    'age.title': 'Verificação de idade',
    'age.description': '{brand} é para maiores de 18 anos porque aqui são feitos pagamentos e reservas diretamente com criadores. Confirme sua idade para continuar.',
    'age.warning': 'Aviso legal',
    'age.warningText': 'Ao entrar, você declara sob juramento que tem 18 anos ou mais. O acesso de menores é estritamente proibido.',
    'age.confirm': 'Sim, tenho mais de 18 anos',
    'age.deny': 'Não, tenho menos de 18 anos',
    'age.denied.title': 'Acesso negado',
    'age.denied.text': 'Desculpe, você deve ter mais de 18 anos para acessar o {brand}. Você será redirecionado em um momento.',
    'age.denied.button': 'Sair do site',
    'age.terms': 'Ao continuar, você aceita nossos',
    'age.termsLink': 'Termos de Serviço',
    'age.and': 'e',
    'age.privacyLink': 'Política de Privacidade',
    
    // Login
    'login.title': 'Bem-vindo de volta',
    'login.subtitle': 'Entre na sua conta',
    'login.email': 'Endereço de email',
    'login.password': 'Senha',
    'login.remember': 'Lembrar-me',
    'login.forgot': 'Esqueceu sua senha?',
    'login.submit': 'Entrar',
    'login.or': 'ou continue com',
    'login.noAccount': 'Não tem conta?',
    'login.register': 'Cadastre-se grátis',
    'login.demo': 'Acesso demo',
    
    // Register
    'register.createAccount': 'Criar conta',
    'register.security': 'Segurança',
    'register.accountType': 'Tipo de conta',
    'register.basicInfo': 'Insira seus dados básicos',
    'register.passwordInfo': 'Crie uma senha segura',
    'register.howToUse': 'Como você quer usar o {brand}?',
    'register.fullName': 'Nome completo',
    'register.email': 'Endereço de email',
    'register.password': 'Senha',
    'register.confirmPassword': 'Confirmar senha',
    'register.continue': 'Continuar',
    'register.back': 'Voltar',
    'register.fan': 'Fã',
    'register.fanDesc': 'Ver e apoiar criadores',
    'register.creator': 'Criador',
    'register.creatorDesc': 'Publicar e monetizar',
    'register.terms': 'Aceito os',
    'register.termsLink': 'Termos de Serviço',
    'register.and': 'a',
    'register.privacyLink': 'Política de Privacidade',
    'register.ageConfirm': 'e confirmo que tenho mais de 18 anos.',
    'register.submit': 'Criar conta',
    'register.hasAccount': 'Já tem conta?',
    'register.login': 'Entre',
    
    // Common
    'common.perMonth': '/mês',
    'common.followers': 'Seguidores',
    'common.posts': 'Publicações',
    'common.likes': 'Curtidas',
    'common.subscribe': 'Assinar',
    'common.subscribed': 'Assinado',
    'common.unlock': 'Desbloquear',
    'common.exclusiveContent': 'Conteúdo exclusivo',
    'common.tip': 'Gorjeta',
    'common.share': 'Compartilhar',
    'common.report': 'Reportar',
    'common.save': 'Salvar',
    'common.cancel': 'Cancelar',
    'common.delete': 'Excluir',
    'common.edit': 'Editar',
    'common.view': 'Ver',
    'common.all': 'Todos',
  },
  
  fr: {
    // Navbar
    'nav.explore': 'Explorer',
    'nav.dashboard': 'Tableau de bord',
    'nav.admin': 'Admin',
    'nav.profile': 'Mon profil',
    'nav.settings': 'Paramètres',
    'nav.help': 'Aide',
    'nav.logout': 'Déconnexion',
    'nav.login': 'Connexion',
    'nav.register': 'S\'inscrire',
    
    // Age verification
    'age.title': 'Vérification de l\'âge',
    'age.description': '{brand} est réservé aux personnes de 18 ans et plus, car les paiements et réservations se font directement avec les créateurs. Confirmez votre âge pour continuer.',
    'age.warning': 'Avis légal',
    'age.warningText': 'En entrant, vous déclarez sous serment que vous avez 18 ans ou plus. L\'accès aux mineurs est strictement interdit.',
    'age.confirm': 'Oui, j\'ai plus de 18 ans',
    'age.deny': 'Non, j\'ai moins de 18 ans',
    'age.denied.title': 'Accès refusé',
    'age.denied.text': 'Désolé, vous devez avoir plus de 18 ans pour accéder à {brand}. Vous serez redirigé dans un instant.',
    'age.denied.button': 'Quitter le site',
    'age.terms': 'En continuant, vous acceptez nos',
    'age.termsLink': 'Conditions d\'Utilisation',
    'age.and': 'et',
    'age.privacyLink': 'Politique de Confidentialité',
    
    // Login
    'login.title': 'Bienvenue',
    'login.subtitle': 'Connectez-vous à votre compte',
    'login.email': 'Adresse email',
    'login.password': 'Mot de passe',
    'login.remember': 'Se souvenir de moi',
    'login.forgot': 'Mot de passe oublié?',
    'login.submit': 'Connexion',
    'login.or': 'ou continuer avec',
    'login.noAccount': 'Vous n\'avez pas de compte?',
    'login.register': 'Inscrivez-vous gratuitement',
    'login.demo': 'Accès démo',
    
    // Register
    'register.createAccount': 'Créer un compte',
    'register.security': 'Sécurité',
    'register.accountType': 'Type de compte',
    'register.basicInfo': 'Entrez vos informations de base',
    'register.passwordInfo': 'Créez un mot de passe sécurisé',
    'register.howToUse': 'Comment voulez-vous utiliser {brand}?',
    'register.fullName': 'Nom complet',
    'register.email': 'Adresse email',
    'register.password': 'Mot de passe',
    'register.confirmPassword': 'Confirmer le mot de passe',
    'register.continue': 'Continuer',
    'register.back': 'Retour',
    'register.fan': 'Fan',
    'register.fanDesc': 'Voir et soutenir les créateurs',
    'register.creator': 'Créateur',
    'register.creatorDesc': 'Publier et monétiser',
    'register.terms': 'J\'accepte les',
    'register.termsLink': 'Conditions d\'Utilisation',
    'register.and': 'la',
    'register.privacyLink': 'Politique de Confidentialité',
    'register.ageConfirm': 'et je confirme que j\'ai plus de 18 ans.',
    'register.submit': 'Créer le compte',
    'register.hasAccount': 'Vous avez déjà un compte?',
    'register.login': 'Connectez-vous',
    
    // Common
    'common.perMonth': '/mois',
    'common.followers': 'Abonnés',
    'common.posts': 'Publications',
    'common.likes': 'J\'aime',
    'common.subscribe': 'S\'abonner',
    'common.subscribed': 'Abonné',
    'common.unlock': 'Débloquer',
    'common.exclusiveContent': 'Contenu exclusif',
    'common.tip': 'Pourboire',
    'common.share': 'Partager',
    'common.report': 'Signaler',
    'common.save': 'Sauvegarder',
    'common.cancel': 'Annuler',
    'common.delete': 'Supprimer',
    'common.edit': 'Modifier',
    'common.view': 'Voir',
    'common.all': 'Tous',
  },
  
  it: {
    // Navbar
    'nav.explore': 'Esplora',
    'nav.dashboard': 'Pannello',
    'nav.admin': 'Admin',
    'nav.profile': 'Il mio profilo',
    'nav.settings': 'Impostazioni',
    'nav.help': 'Aiuto',
    'nav.logout': 'Esci',
    'nav.login': 'Accedi',
    'nav.register': 'Registrati',
    
    // Age verification
    'age.title': 'Verifica dell\'età',
    'age.description': '{brand} è riservato ai maggiori di 18 anni perché qui si effettuano pagamenti e prenotazioni direttamente con i creator. Conferma la tua età per continuare.',
    'age.warning': 'Avviso legale',
    'age.warningText': 'Entrando, dichiari sotto giuramento di avere 18 anni o più. L\'accesso ai minori è severamente vietato.',
    'age.confirm': 'Sì, ho più di 18 anni',
    'age.deny': 'No, ho meno di 18 anni',
    'age.denied.title': 'Accesso negato',
    'age.denied.text': 'Spiacenti, devi avere più di 18 anni per accedere a {brand}. Sarai reindirizzato tra un momento.',
    'age.denied.button': 'Esci dal sito',
    'age.terms': 'Continuando, accetti i nostri',
    'age.termsLink': 'Termini di Servizio',
    'age.and': 'e',
    'age.privacyLink': 'Informativa sulla Privacy',
    
    // Login
    'login.title': 'Bentornato',
    'login.subtitle': 'Accedi al tuo account',
    'login.email': 'Indirizzo email',
    'login.password': 'Password',
    'login.remember': 'Ricordami',
    'login.forgot': 'Password dimenticata?',
    'login.submit': 'Accedi',
    'login.or': 'o continua con',
    'login.noAccount': 'Non hai un account?',
    'login.register': 'Registrati gratuitamente',
    'login.demo': 'Accesso demo',
    
    // Register
    'register.createAccount': 'Crea account',
    'register.security': 'Sicurezza',
    'register.accountType': 'Tipo di account',
    'register.basicInfo': 'Inserisci le tue informazioni di base',
    'register.passwordInfo': 'Crea una password sicura',
    'register.howToUse': 'Come vuoi usare {brand}?',
    'register.fullName': 'Nome completo',
    'register.email': 'Indirizzo email',
    'register.password': 'Password',
    'register.confirmPassword': 'Conferma password',
    'register.continue': 'Continua',
    'register.back': 'Indietro',
    'register.fan': 'Fan',
    'register.fanDesc': 'Segui e sostieni i creator',
    'register.creator': 'Creatore',
    'register.creatorDesc': 'Pubblica e monetizza',
    'register.terms': 'Accetto i',
    'register.termsLink': 'Termini di Servizio',
    'register.and': 'l\'',
    'register.privacyLink': 'Informativa sulla Privacy',
    'register.ageConfirm': 'e confermo di avere più di 18 anni.',
    'register.submit': 'Crea account',
    'register.hasAccount': 'Hai già un account?',
    'register.login': 'Accedi',
    
    // Common
    'common.perMonth': '/mese',
    'common.followers': 'Follower',
    'common.posts': 'Pubblicazioni',
    'common.likes': 'Mi piace',
    'common.subscribe': 'Iscriviti',
    'common.subscribed': 'Iscritto',
    'common.unlock': 'Sblocca',
    'common.exclusiveContent': 'Contenuto esclusivo',
    'common.tip': 'Mancia',
    'common.share': 'Condividi',
    'common.report': 'Segnala',
    'common.save': 'Salva',
    'common.cancel': 'Annulla',
    'common.delete': 'Elimina',
    'common.edit': 'Modifica',
    'common.view': 'Visualizza',
    'common.all': 'Tutti',
  },
};

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(detectLanguage());

  useEffect(() => {
    localStorage.setItem(LANGUAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
  };

  const t = (key: string): string => {
    const text = translations[language][key] || key;
    return text.replace(/\{brand\}/g, BRAND.name);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
};

export const languageNames: Record<Language, string> = {
  es: 'Español',
  en: 'English',
  pt: 'Português',
  fr: 'Français',
  it: 'Italiano',
};
