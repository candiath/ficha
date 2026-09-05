// ─── Types ────────────────────────────────────────────────────────────────────

export type ExerciseDifficulty = 'easy' | 'medium' | 'hard'
export type ExerciseCategory = 'Respiracion' | 'Elongacion' | 'Postural' | 'Fortalecimiento'
export type AlertType = 'follow_up' | 'no_show' | 'payment' | 'custom'
export type MessageCategory = 'reminder' | 'cancellation' | 'follow_up' | 'general'

// Los pacientes de ejemplo que todavía usa la maqueta de Mensajes. La
// pantalla solo se monta en desarrollo, así que esto no llega a producción;
// desaparece cuando Mensajes tenga backend (#127).
export interface MockPatient {
  id: string
  fullName: string
  occupation: string
  status: 'active' | 'discharged'
}

export interface Exercise {
  id: string
  name: string
  description: string
  instructions: string[]
  duration: string
  frequency: string
  category: ExerciseCategory
  difficulty: ExerciseDifficulty
}

export interface Alert {
  id: string
  patientId: string
  type: AlertType
  message: string
  createdAt: string
  isRead: boolean
}

export interface MessageTemplate {
  id: string
  name: string
  category: MessageCategory
  content: string
}

// ─── Patients ─────────────────────────────────────────────────────────────────

export const mockPatients: MockPatient[] = [
  { id: 'p1', fullName: 'María García López',     occupation: 'Diseñadora gráfica',     status: 'active' },
  { id: 'p2', fullName: 'Carlos Rodríguez Pérez', occupation: 'Contador',               status: 'active' },
  { id: 'p3', fullName: 'Ana Martínez Ruiz',      occupation: 'Profesora de yoga',      status: 'active' },
  { id: 'p4', fullName: 'Jorge Luis Méndez',      occupation: 'Jubilado',               status: 'discharged' },
  { id: 'p5', fullName: 'Lucía Fernández Torres', occupation: 'Abogada',                status: 'active' },
  { id: 'p6', fullName: 'Pedro Sánchez Díaz',     occupation: 'Ingeniero de software',  status: 'active' },
]

// ─── Exercises ────────────────────────────────────────────────────────────────

export const exercises: Exercise[] = [
  {
    id: 'ex1',
    name: 'Respiración diafragmática',
    description: 'Ejercicio básico de respiración para mejorar el patrón respiratorio.',
    instructions: [
      'Acuéstate boca arriba con las rodillas flexionadas',
      'Coloca una mano en el pecho y otra en el abdomen',
      'Inspira lentamente por la nariz, sintiendo cómo sube el abdomen',
      'Espira lentamente por la boca',
      'Repite 10 veces',
    ],
    duration: '5 minutos',
    frequency: '3 veces al día',
    category: 'Respiracion',
    difficulty: 'easy',
  },
  {
    id: 'ex2',
    name: 'Estiramiento de isquiotibiales',
    description: 'Elongación de la cadena posterior de miembros inferiores.',
    instructions: [
      'Siéntate en el piso con una pierna extendida',
      'Flexiona la otra pierna con el pie apoyado en el muslo interno',
      'Inclínate hacia adelante desde la cadera manteniendo la espalda recta',
      'Mantén 30 segundos y cambia de pierna',
    ],
    duration: '2 minutos por lado',
    frequency: '2 veces al día',
    category: 'Elongacion',
    difficulty: 'easy',
  },
  {
    id: 'ex3',
    name: 'Retracción cervical',
    description: 'Ejercicio para corregir la posición adelantada de la cabeza.',
    instructions: [
      'Siéntate o párate con la espalda recta',
      'Lleva el mentón hacia atrás como haciendo "papada"',
      'Mantén 5 segundos',
      'Relaja y repite 10 veces',
    ],
    duration: '2 minutos',
    frequency: 'Cada hora de trabajo',
    category: 'Postural',
    difficulty: 'easy',
  },
  {
    id: 'ex4',
    name: 'Estiramiento de pectorales en esquina',
    description: 'Apertura de la cadena anterior del tronco superior.',
    instructions: [
      'Párate frente a una esquina o puerta abierta',
      'Coloca un antebrazo en cada pared a 90 grados',
      'Inclínate lentamente hacia adelante hasta sentir el estiramiento en el pecho',
      'Mantén 30 segundos',
      'Repite 3 veces',
    ],
    duration: '3 minutos',
    frequency: '2 veces al día',
    category: 'Elongacion',
    difficulty: 'easy',
  },
  {
    id: 'ex5',
    name: 'Activación de transverso abdominal',
    description: 'Fortalecimiento de la musculatura profunda del core.',
    instructions: [
      'Acuéstate boca arriba con rodillas flexionadas',
      'Respira normalmente y al exhalar contrae el ombligo hacia la columna',
      'Mantén la contracción 10 segundos sin contener la respiración',
      'Relaja y repite 10 veces',
    ],
    duration: '5 minutos',
    frequency: '1 vez al día',
    category: 'Fortalecimiento',
    difficulty: 'medium',
  },
  {
    id: 'ex6',
    name: 'Movilización torácica en decúbito lateral',
    description: 'Ganancia de movilidad rotatoria de la columna dorsal.',
    instructions: [
      'Acuéstate de lado con caderas y rodillas a 90 grados',
      'Extiende ambos brazos al frente',
      'Lleva el brazo superior hacia atrás en rotación, siguiendo con la mirada',
      'Vuelve a la posición inicial',
      'Realiza 10 repeticiones por lado',
    ],
    duration: '5 minutos por lado',
    frequency: '1 vez al día',
    category: 'Postural',
    difficulty: 'medium',
  },
]

// ─── Alerts ───────────────────────────────────────────────────────────────────

export const mockAlerts: Alert[] = [
  {
    id: 'al1',
    patientId: 'p1',
    type: 'follow_up',
    message: 'María García no ha tenido sesión en 3 semanas. Considerar contacto de seguimiento.',
    createdAt: '2026-03-20',
    isRead: false,
  },
  {
    id: 'al2',
    patientId: 'p5',
    type: 'payment',
    message: 'Lucía Fernández Torres tiene un pago pendiente de la sesión del 26/11/2025.',
    createdAt: '2026-03-18',
    isRead: false,
  },
  {
    id: 'al3',
    patientId: 'p2',
    type: 'no_show',
    message: 'Carlos Rodríguez Pérez no se presentó al turno del 15/03/2026.',
    createdAt: '2026-03-15',
    isRead: false,
  },
  {
    id: 'al4',
    patientId: 'p3',
    type: 'follow_up',
    message: 'Ana Martínez Ruiz completó 10 sesiones. Evaluar evolución y continuar plan.',
    createdAt: '2026-03-10',
    isRead: true,
  },
  {
    id: 'al5',
    patientId: 'p6',
    type: 'custom',
    message: 'Pedro Sánchez solicitó cambio de horario para sus próximas sesiones.',
    createdAt: '2026-03-08',
    isRead: true,
  },
]

// ─── Message templates ────────────────────────────────────────────────────────

export const messageTemplates: MessageTemplate[] = [
  {
    id: 'mt1',
    name: 'Recordatorio de turno',
    category: 'reminder',
    content: 'Hola {nombre}, te recordamos que tenés turno con nosotros el {fecha} a las {hora}. Por favor confirmá tu asistencia. Saludos, {profesional}.',
  },
  {
    id: 'mt2',
    name: 'Cancelación de turno',
    category: 'cancellation',
    content: 'Hola {nombre}, lamentablemente debemos cancelar el turno del {fecha} a las {hora}. Te contactaremos para reprogramar a la brevedad. Disculpá el inconveniente. Saludos, {profesional}.',
  },
  {
    id: 'mt3',
    name: 'Seguimiento post-sesión',
    category: 'follow_up',
    content: 'Hola {nombre}, ¿cómo te sentiste después de la sesión del {fecha}? Recordá hacer los ejercicios asignados. ¡Cualquier consulta estamos disponibles! Saludos, {profesional}.',
  },
  {
    id: 'mt4',
    name: 'Saludo de alta',
    category: 'general',
    content: 'Hola {nombre}, ¡felicitaciones por completar tu tratamiento! Fue un placer acompañarte en este proceso. Recordá continuar con los ejercicios en casa. Ante cualquier molestia, no dudes en contactarnos. Saludos, {profesional}.',
  },
  {
    id: 'mt5',
    name: 'Cobro pendiente',
    category: 'general',
    content: 'Hola {nombre}, te recordamos que tenés un pago pendiente de la sesión del {fecha}. Podés abonarlo en tu próxima visita o por transferencia. Gracias. {profesional}.',
  },
]
