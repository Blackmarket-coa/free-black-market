import { useState } from "react"
import {
  ArrowRight,
  Check,
  CurrencyDollar,
  Users,
  ShieldCheck,
  Sparkles,
  ChartBar,
} from "@medusajs/icons"
import { Badge, Button, Heading, Text, clx } from "@medusajs/ui"

// Custom ProgressBar since @medusajs/ui might not have it
const ProgressBar = ({ value }: { value: number }) => (
  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
    <div
      className="h-full bg-blue-500 transition-all duration-300"
      style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
    />
  </div>
)

/**
 * Onboarding Stages based on psychological progression:
 * 1. Safety - "You are not giving up control"
 * 2. Possibility - "Here's what could happen"
 * 3. Commitment - "Let's get your first dollar"
 * 4. Belonging - "You're part of something larger"
 */

type OnboardingStage = "safety" | "possibility" | "commitment" | "belonging"

interface OnboardingState {
  currentStage: OnboardingStage
  completed: {
    safety: boolean
    possibility: boolean
    commitment: boolean
    belonging: boolean
  }
  sellerData?: {
    name?: string
    email?: string
    type?: string
  }
}

interface VendorOnboardingFlowProps {
  initialState?: Partial<OnboardingState>
  onComplete?: () => void
  onStageComplete?: (stage: OnboardingStage) => void
}

/**
 * Vendor Onboarding Flow
 * 
 * "Reduce fear → build confidence → show money early"
 */
export const VendorOnboardingFlow = ({
  initialState,
  onComplete,
  onStageComplete,
}: VendorOnboardingFlowProps) => {
  const [state, setState] = useState<OnboardingState>({
    currentStage: "safety",
    completed: {
      safety: false,
      possibility: false,
      commitment: false,
      belonging: false,
    },
    ...initialState,
  })

  const advanceStage = () => {
    const stages: OnboardingStage[] = ["safety", "possibility", "commitment", "belonging"]
    const currentIndex = stages.indexOf(state.currentStage)
    
    // Mark current as complete
    setState(prev => ({
      ...prev,
      completed: {
        ...prev.completed,
        [prev.currentStage]: true,
      },
    }))
    
    onStageComplete?.(state.currentStage)
    
    if (currentIndex < stages.length - 1) {
      setState(prev => ({
        ...prev,
        currentStage: stages[currentIndex + 1],
      }))
    } else {
      onComplete?.()
    }
  }

  const getProgress = () => {
    const completedCount = Object.values(state.completed).filter(Boolean).length
    return (completedCount / 4) * 100
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <Text className="text-sm text-gray-500">Getting Started</Text>
          <Text className="text-sm font-medium">{Math.round(getProgress())}% complete</Text>
        </div>
        <ProgressBar value={getProgress()} />
        
        {/* Stage indicators */}
        <div className="flex items-center justify-between mt-4">
          {(["safety", "possibility", "commitment", "belonging"] as OnboardingStage[]).map(
            (stage, idx) => (
              <div
                key={stage}
                className={clx(
                  "flex items-center gap-2",
                  state.completed[stage]
                    ? "text-green-600"
                    : state.currentStage === stage
                    ? "text-blue-600"
                    : "text-gray-400"
                )}
              >
                <div
                  className={clx(
                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                    state.completed[stage]
                      ? "bg-green-100"
                      : state.currentStage === stage
                      ? "bg-blue-100"
                      : "bg-gray-100"
                  )}
                >
                  {state.completed[stage] ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    idx + 1
                  )}
                </div>
                <Text className="text-sm hidden sm:block capitalize">{stage}</Text>
              </div>
            )
          )}
        </div>
      </div>

      {/* Stage Content */}
      <div className="bg-white border rounded-lg p-6">
        {state.currentStage === "safety" && (
          <SafetyStage onContinue={advanceStage} />
        )}
        {state.currentStage === "possibility" && (
          <PossibilityStage onContinue={advanceStage} />
        )}
        {state.currentStage === "commitment" && (
          <CommitmentStage onContinue={advanceStage} />
        )}
        {state.currentStage === "belonging" && (
          <BelongingStage onContinue={advanceStage} />
        )}
      </div>
    </div>
  )
}

// ============================================
// Stage 1: Safety
// ============================================

interface StageProps {
  onContinue: () => void
}

const SafetyStage = ({ onContinue }: StageProps) => {
  const [acknowledged, setAcknowledged] = useState<string[]>([])
  
  const safetyPoints = [
    {
      id: "no-exclusivity",
      icon: <ShieldCheck className="w-5 h-5" />,
      title: "No exclusivity required",
      description: "Sell on other platforms too. This doesn't lock you in.",
    },
    {
      id: "no-hidden-fees",
      icon: <CurrencyDollar className="w-5 h-5" />,
      title: "No hidden fees",
      description:
        "3% platform fee on the free plan, lower on an optional paid plan. No surprise charges.",
    },
    {
      id: "clear-payouts",
      icon: <ChartBar className="w-5 h-5" />,
      title: "Clear payout timing",
      description: "Get paid weekly. See exactly what you're owed in your dashboard.",
    },
    {
      id: "leave-anytime",
      icon: <ArrowRight className="w-5 h-5" />,
      title: "Leave anytime",
      description: "No contracts. No penalties. Your customers stay yours.",
    },
  ]
  
  const toggleAcknowledge = (id: string) => {
    setAcknowledged(prev => 
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    )
  }
  
  const allAcknowledged = acknowledged.length === safetyPoints.length
  
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
          <ShieldCheck className="w-6 h-6 text-green-600" />
        </div>
        <div>
          <Heading level="h2">You're in control</Heading>
          <Text className="text-gray-500">
            This is your business. We're just here to help.
          </Text>
        </div>
      </div>
      
      <div className="space-y-4 mb-6">
        {safetyPoints.map((point) => (
          <button
            key={point.id}
            onClick={() => toggleAcknowledge(point.id)}
            className={clx(
              "w-full p-4 rounded-lg border text-left transition-all",
              acknowledged.includes(point.id)
                ? "border-green-300 bg-green-50"
                : "border-gray-200 hover:border-gray-300"
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className={clx(
                  "w-8 h-8 rounded-lg flex items-center justify-center",
                  acknowledged.includes(point.id)
                    ? "bg-green-200 text-green-700"
                    : "bg-gray-100 text-gray-500"
                )}
              >
                {acknowledged.includes(point.id) ? (
                  <Check className="w-4 h-4" />
                ) : (
                  point.icon
                )}
              </div>
              <div>
                <Text className="font-medium">{point.title}</Text>
                <Text className="text-sm text-gray-500">{point.description}</Text>
              </div>
            </div>
          </button>
        ))}
      </div>
      
      <Button 
        onClick={onContinue} 
        disabled={!allAcknowledged}
        className="w-full"
      >
        I understand, let's continue
        <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
      
      {!allAcknowledged && (
        <Text className="text-sm text-gray-400 text-center mt-2">
          Tap each item to acknowledge
        </Text>
      )}
    </div>
  )
}

// ============================================
// Stage 2: Possibility
// ============================================

const PossibilityStage = ({ onContinue }: StageProps) => {
  const [weeklyOrders, setWeeklyOrders] = useState(10)
  const [avgOrderValue, setAvgOrderValue] = useState(50)
  
  const weeklyRevenue = weeklyOrders * avgOrderValue
  const monthlyRevenue = weeklyRevenue * 4.33
  const platformFee = monthlyRevenue * 0.03
  const yourEarnings = monthlyRevenue - platformFee
  
  const successStories = [
    {
      name: "Maria's Garden",
      type: "Urban Farm",
      stat: "$3,200/month",
      quote: "Started with just tomatoes. Now I have 45 regular customers.",
    },
    {
      name: "Oak Ridge Farm",
      type: "Family Farm", 
      stat: "$8,500/month",
      quote: "Subscriptions changed everything. Predictable income means I can plan ahead.",
    },
  ]
  
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center">
          <Sparkles className="w-6 h-6 text-amber-600" />
        </div>
        <div>
          <Heading level="h2">Here's what's possible</Heading>
          <Text className="text-gray-500">
            See what other producers are achieving
          </Text>
        </div>
      </div>
      
      {/* Earnings Calculator */}
      <div className="bg-gray-50 rounded-lg p-4 mb-6">
        <Text className="font-medium mb-4">Quick Earnings Estimate</Text>
        
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <Text className="text-sm text-gray-600">Orders per week</Text>
              <Text className="font-medium">{weeklyOrders}</Text>
            </div>
            <input
              type="range"
              min="1"
              max="50"
              value={weeklyOrders}
              onChange={(e) => setWeeklyOrders(Number(e.target.value))}
              className="w-full"
            />
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-1">
              <Text className="text-sm text-gray-600">Average order value</Text>
              <Text className="font-medium">${avgOrderValue}</Text>
            </div>
            <input
              type="range"
              min="10"
              max="200"
              step="5"
              value={avgOrderValue}
              onChange={(e) => setAvgOrderValue(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
        
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <Text className="text-gray-600">Monthly revenue</Text>
            <Text>${monthlyRevenue.toLocaleString()}</Text>
          </div>
          <div className="flex items-center justify-between mb-2">
            <Text className="text-gray-600">Platform fee (3%)</Text>
            <Text className="text-gray-500">-${platformFee.toLocaleString()}</Text>
          </div>
          <div className="flex items-center justify-between pt-2 border-t">
            <Text className="font-semibold text-green-700">You earn</Text>
            <Text className="text-2xl font-bold text-green-600">
              ${yourEarnings.toLocaleString()}
            </Text>
          </div>
        </div>
      </div>
      
      {/* Success Stories */}
      <div className="mb-6">
        <Text className="font-medium mb-3">Producer Success Stories</Text>
        <div className="grid grid-cols-1 gap-3">
          {successStories.map((story) => (
            <div key={story.name} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <Text className="font-medium">{story.name}</Text>
                  <Text className="text-sm text-gray-500">{story.type}</Text>
                </div>
                <Badge color="green">{story.stat}</Badge>
              </div>
              <Text className="text-sm text-gray-600 italic">"{story.quote}"</Text>
            </div>
          ))}
        </div>
      </div>
      
      <Button onClick={onContinue} className="w-full">
        I'm ready to get started
        <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
    </div>
  )
}

// ============================================
// Stage 3: Commitment
// ============================================

const CommitmentStage = ({ onContinue }: StageProps) => {
  const [checklist, setChecklist] = useState({
    product: false,
    photo: false,
    price: false,
    fulfillment: false,
  })
  
  const checklistItems = [
    {
      id: "product",
      title: "Add your first product",
      description: "Just one to start. You can add more anytime.",
      action: "Add Product",
    },
    {
      id: "photo",
      title: "Upload a product photo",
      description: "A simple phone photo works great.",
      action: "Upload Photo",
    },
    {
      id: "price",
      title: "Set your price",
      description: "You decide what you're worth. We don't negotiate.",
      action: "Set Price",
    },
    {
      id: "fulfillment",
      title: "Choose how you'll fulfill orders",
      description: "Delivery, pickup, or both - your call.",
      action: "Choose Method",
    },
  ]
  
  const completedCount = Object.values(checklist).filter(Boolean).length
  const allComplete = completedCount === Object.keys(checklist).length
  
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
          <CurrencyDollar className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <Heading level="h2">Let's get your first dollar</Heading>
          <Text className="text-gray-500">
            Complete these 4 simple steps to launch
          </Text>
        </div>
      </div>
      
      {/* Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <Text className="text-sm text-gray-500">Launch checklist</Text>
          <Text className="text-sm font-medium">{completedCount} of 4 complete</Text>
        </div>
        <ProgressBar value={(completedCount / 4) * 100} />
      </div>
      
      {/* Checklist */}
      <div className="space-y-3 mb-6">
        {checklistItems.map((item) => (
          <div
            key={item.id}
            className={clx(
              "p-4 rounded-lg border transition-all",
              checklist[item.id as keyof typeof checklist]
                ? "border-green-300 bg-green-50"
                : "border-gray-200"
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div
                  className={clx(
                    "w-6 h-6 rounded-full flex items-center justify-center mt-0.5",
                    checklist[item.id as keyof typeof checklist]
                      ? "bg-green-500 text-white"
                      : "border-2 border-gray-300"
                  )}
                >
                  {checklist[item.id as keyof typeof checklist] && (
                    <Check className="w-3 h-3" />
                  )}
                </div>
                <div>
                  <Text className="font-medium">{item.title}</Text>
                  <Text className="text-sm text-gray-500">{item.description}</Text>
                </div>
              </div>
              <Button
                variant="secondary"
                size="small"
                onClick={() => 
                  setChecklist(prev => ({ ...prev, [item.id]: true }))
                }
                disabled={checklist[item.id as keyof typeof checklist]}
              >
                {checklist[item.id as keyof typeof checklist] ? "Done" : item.action}
              </Button>
            </div>
          </div>
        ))}
      </div>
      
      {allComplete && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-green-700">
            <Sparkles className="w-5 h-5" />
            <Text className="font-medium">You're ready to launch!</Text>
          </div>
          <Text className="text-sm text-green-600 mt-1">
            Your first product is live. Time to make your first sale!
          </Text>
        </div>
      )}
      
      <Button onClick={onContinue} disabled={!allComplete} className="w-full">
        {allComplete ? "Launch my store" : "Complete all steps to continue"}
        <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
    </div>
  )
}

// ============================================
// Stage 4: Belonging
// ============================================

const BelongingStage = ({ onContinue }: StageProps) => {
  const communityStats = {
    totalProducers: 247,
    totalCustomers: 12580,
    totalToProducers: 1847293,
    localMiles: "2.3M",
  }
  
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
          <Users className="w-6 h-6 text-purple-600" />
        </div>
        <div>
          <Heading level="h2">Welcome to the community</Heading>
          <Text className="text-gray-500">
            You're part of something bigger now
          </Text>
        </div>
      </div>
      
      {/* Community Stats */}
      <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-lg p-6 mb-6">
        <Text className="font-medium text-gray-700 mb-4">
          Together, we're building a different kind of food system
        </Text>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <Text className="text-3xl font-bold text-purple-600">
              {communityStats.totalProducers}
            </Text>
            <Text className="text-sm text-gray-600">Producers</Text>
          </div>
          <div className="text-center">
            <Text className="text-3xl font-bold text-blue-600">
              {communityStats.totalCustomers.toLocaleString()}
            </Text>
            <Text className="text-sm text-gray-600">Customers</Text>
          </div>
          <div className="text-center">
            <Text className="text-3xl font-bold text-green-600">
              ${(communityStats.totalToProducers / 1000000).toFixed(1)}M
            </Text>
            <Text className="text-sm text-gray-600">Paid to Producers</Text>
          </div>
          <div className="text-center">
            <Text className="text-3xl font-bold text-amber-600">
              {communityStats.localMiles}
            </Text>
            <Text className="text-sm text-gray-600">Food Miles Saved</Text>
          </div>
        </div>
      </div>
      
      {/* Community Resources */}
      <div className="space-y-3 mb-6">
        <Text className="font-medium">Connect with the community</Text>
        
        <button className="w-full p-4 border rounded-lg text-left hover:bg-gray-50 transition-colors">
          <Text className="font-medium">Producer Forum</Text>
          <Text className="text-sm text-gray-500">
            Ask questions, share tips, connect with other producers
          </Text>
        </button>
        
        <button className="w-full p-4 border rounded-lg text-left hover:bg-gray-50 transition-colors">
          <Text className="font-medium">Weekly Newsletter</Text>
          <Text className="text-sm text-gray-500">
            Platform updates, success stories, seasonal tips
          </Text>
        </button>
        
        <button className="w-full p-4 border rounded-lg text-left hover:bg-gray-50 transition-colors">
          <Text className="font-medium">Producer Meetups</Text>
          <Text className="text-sm text-gray-500">
            Monthly virtual gatherings to learn and network
          </Text>
        </button>
      </div>
      
      {/* Final CTA */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
        <Text className="font-medium text-green-800 mb-2">
          🎉 You're all set!
        </Text>
        <Text className="text-sm text-green-700">
          Your store is live. Start sharing your link with customers and 
          watch your first orders come in.
        </Text>
      </div>
      
      <Button onClick={onContinue} className="w-full">
        Go to my dashboard
        <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
    </div>
  )
}

export default VendorOnboardingFlow
