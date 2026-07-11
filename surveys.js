/** A small catalog of surveys. Each pays a USD reward once, on completion. */
const SURVEYS = [
  {
    id: 'S1', title: 'Consumer shopping habits', minutes: 4, reward: 0.45,
    questions: [
      { q: 'How often do you shop online?', options: ['Daily', 'Weekly', 'Monthly', 'Rarely'] },
      { q: 'What matters most when you buy?', options: ['Price', 'Quality', 'Speed', 'Reviews'] },
      { q: 'Preferred payment method?', options: ['Mobile money', 'Card', 'Cash on delivery', 'PayPal'] },
    ],
  },
  {
    id: 'S2', title: 'Mobile & technology use', minutes: 3, reward: 0.35,
    questions: [
      { q: 'Which device do you use most?', options: ['Phone', 'Laptop', 'Tablet', 'Desktop'] },
      { q: 'How many apps do you use daily?', options: ['1–3', '4–6', '7–10', 'More than 10'] },
      { q: 'Do you use mobile money?', options: ['Yes, often', 'Sometimes', 'Rarely', 'Never'] },
    ],
  },
  {
    id: 'S3', title: 'Travel & leisure', minutes: 5, reward: 0.60,
    questions: [
      { q: 'How often do you travel?', options: ['Monthly', 'A few times a year', 'Once a year', 'Rarely'] },
      { q: 'Preferred trip type?', options: ['City', 'Beach', 'Nature', 'Adventure'] },
      { q: 'How do you book trips?', options: ['App', 'Website', 'Agent', 'Phone'] },
    ],
  },
  {
    id: 'S4', title: 'Food & dining', minutes: 3, reward: 0.30,
    questions: [
      { q: 'How often do you order food in?', options: ['Daily', 'Weekly', 'Monthly', 'Rarely'] },
      { q: 'Preferred cuisine?', options: ['Local', 'Fast food', 'Healthy', 'International'] },
    ],
  },
  {
    id: 'S5', title: 'Work & productivity', minutes: 4, reward: 0.50,
    questions: [
      { q: 'Where do you mostly work?', options: ['Office', 'Home', 'Hybrid', 'On the go'] },
      { q: 'Biggest productivity tool?', options: ['Calendar', 'To-do app', 'Notes', 'Chat apps'] },
      { q: 'How do you earn online?', options: ['Tasks', 'Surveys', 'Freelance', 'Not yet'] },
    ],
  },
];

module.exports = { SURVEYS, byId: (id) => SURVEYS.find((s) => s.id === id) || null };
